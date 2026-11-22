package controllers.inbox

import java.net.URI
import java.nio.charset.StandardCharsets.UTF_8
import scala.util.Try

import play.api.libs.json.*

import lila.app.*
import lila.core.id.PuzzleId
import lila.msg.{ MsgActionError, MsgBoard }
import lila.threeKingdoms.{ Kingdom, Location, Move, Position, PositionCodec, Rules }
import lila.xiangqi.{ Xiangqi, XiangqiAnnotations, XiangqiNotation, XiangqiRules }

private[inbox] final class MsgBoards(env: Env):
  import MsgBoards.*

  private given Executor = env.executor
  private val limit = lila.memo.RateLimit[UserId](40, 5.minutes, "msg.boards")(using env.net.rateLimit)

  def preview(value: JsValue)(using me: Me): Fu[MsgBoard] =
    requireValid(value.asOpt[Source].filter(validSource)).flatMap: source =>
      limit(me.userId, invalid[MsgBoard]("limited")):
        load(source, None).map(_.copy(code = Option.unless(source.kind == "link")(source.value)))

  def resolve(value: JsValue, body: String)(using me: Me): Fu[Vector[MsgBoard]] =
    requireValid(
      value
        .asOpt[Vector[Draft]]
        .filter: drafts =>
          drafts.nonEmpty && drafts.size <= 3 &&
            drafts.map(_.source.value.getBytes(UTF_8).length).sum <= 24_000 &&
            drafts.forall: draft =>
              validSource(draft.source) && (!draft.source.inline || body.contains(draft.source.bodyValue)) &&
                draft.marks.size <= 64 && draft.marks.map(_.shapes.size).sum <= 128 &&
                draft.marks.map(_.ply).distinct.size == draft.marks.size &&
                draft.marks.forall(mark => mark.shapes.forall(validShape(_, mark.fen)))
    ).flatMap: drafts =>
      limit(me.userId, invalid[Vector[MsgBoard]]("limited"), cost = drafts.size):
        drafts.traverse: draft =>
          load(draft.source, draft.end).flatMap: board =>
            val frames = board.frames.map(frame => frame.ply -> frame).toMap
            val start = draft.start.getOrElse(board.start)
            requireValid(
              Option.when(
                frames.contains(start) && draft.marks.forall(mark =>
                  frames.get(mark.ply).exists(_.fen == mark.fen)
                )
              ):
                val marks = draft.marks.map(mark => mark.ply -> mark.shapes).toMap
                val inline =
                  Option.when(draft.source.inline)(lila.common.String.softCleanUp(draft.source.bodyValue))
                board.copy(
                  start = start,
                  code = Option.when(draft.source.kind != "link" && !inline.contains(draft.source.value))(
                    draft.source.value
                  ),
                  inline = inline,
                  frames = board.frames.map(frame =>
                    frame.copy(shapes = (frame.shapes ++ marks.getOrElse(frame.ply, Vector.empty)).distinct)
                  )
                )
            )

  private def load(source: Source, end: Option[Int]): Fu[MsgBoard] =
    val text = source.value.trim.stripPrefix("\ufeff")
    source.kind match
      case "fen" if text.startsWith("TK1;") =>
        requireValid(PositionCodec.read(text).toOption.map(p => board(Vector(kingdomFrame(p, 0, None)))))
      case "fen" =>
        requireValid(
          XiangqiRules
            .position(Xiangqi.Position(initialFen = text))
            .toOption
            .map: state =>
              board(Vector(frame(state))).copy(title =
                lila.xiangqi.GameVariant.fromKey(state.variant).toOption.map(v => s"${v.name} · FEN")
              )
        )
      case "record" =>
        requireValid(for
          json <- Try(Json.parse(text)).toOption
          if (json \ "format").asOpt[String].contains("LiXiangQi Three Kingdoms") &&
            (json \ "formatVersion").asOpt[Int].contains(1)
          initial <- (json \ "initial").asOpt[String].flatMap(PositionCodec.read(_).toOption)
          events <- (json \ "events").asOpt[Vector[JsObject]].filter(_.size <= 600)
          actions <- events.traverse: event =>
            for
              actor <- (event \ "actor").asOpt[String].flatMap(Kingdom.fromKey)
              action <- (event \ "action").asOpt[String]
            yield actor -> action
          replay <- kingdomBoard(initial, actions, end, None, None)
        yield
          val names = (json \ "seats")
            .asOpt[Vector[JsObject]]
            .filter(_.size == 3)
            .toVector
            .flatten
            .flatMap: seat =>
              (seat \ "user" \ "name")
                .asOpt[String]
                .map(_.take(60))
                .orElse((seat \ "aiLevel").asOpt[Int].map(lila.core.game.AiLevel.displayName))
          replay.copy(title =
            Some((names.mkString(" vs. ") :: "Three Kingdoms" :: Nil).filter(_.nonEmpty).mkString(" · "))
          ))
      case "pgn" =>
        requireValid(
          XiangqiNotation
            .importTree(Xiangqi.NotationImport(notation = text))
            .toOption
            .map: tree =>
              @annotation.tailrec
              def line(
                  previous: Xiangqi.State,
                  children: Vector[Xiangqi.ImportedTreeNode],
                  frames: Vector[MsgBoard.Frame]
              ): Vector[MsgBoard.Frame] =
                children.find(node => !node.annotations.study.exists(_.forceVariation)) match
                  case None => frames
                  case Some(node) =>
                    line(
                      node.state,
                      node.children,
                      frames :+ frame(node.state, Some(node.move -> previous), node.annotations.shapes)
                    )
              board(
                line(tree.state, tree.children, Vector(frame(tree.state, shapes = tree.annotations.shapes)))
              ).copy(title =
                val players = for
                  red <- tree.headers.get("red").orElse(tree.headers.get("white"))
                  black <- tree.headers.get("black")
                yield s"$red vs. $black"
                players.orElse(tree.headers.get("event")).filterNot(_ == "?").map(_.take(180)))
        )
      case "link" =>
        link(text) match
          case Some(Puzzle(id)) =>
            env.puzzle.api.puzzle
              .find(id)
              .flatMap: puzzle =>
                requireValid(
                  puzzle
                    .filterNot(_.retired)
                    .flatMap(_.stateAfterInitialMove)
                    .map(state => board(Vector(frame(state)), state.turn.key, Some(s"/training/${id.value}")))
                )
          case Some(Kingdoms(id, index)) =>
            env.threeKingdoms.repo
              .byId(id)
              .flatMap: game =>
                requireValid(
                  game.flatMap(g =>
                    kingdomBoard(
                      g.initial,
                      g.events.map(e => e.actor -> e.action),
                      end,
                      index,
                      Some(s"/three-kingdoms/game/${id.value}")
                    ).map: replay =>
                      val players = g.seats.map(s =>
                        s.userId
                          .map(env.user.lightUserApi.syncFallback(_).name.value)
                          .orElse(s.aiLevel.map(lila.core.game.AiLevel.displayName))
                          .getOrElse(UserName.anonymous.value)
                      )
                      val clock = g.clock.config
                      replay.copy(title =
                        Some(
                          s"${players.mkString(" vs. ")} · Three Kingdoms · ${clock.initialSeconds / 60}m / ${clock.moveSeconds}s"
                        )
                      )
                  )
                )
          case Some(Game(id, orientation, ply, analysis)) =>
            env.game.gameRepo
              .game(id)
              .flatMap: game =>
                requireValid(
                  game
                    .filter(g => g.started)
                    .flatMap: game =>
                      val history = game.xiangqi
                      val states = game.visibleStates.takeWhile(state => end.forall(state.ply <= _))
                      Option.when(states.nonEmpty && end.forall(states.last.ply == _) && states.size <= 601):
                        val frames = frame(states.head) +: states.tail
                          .zip(history.moves.zip(states))
                          .map: (state, transition) =>
                            frame(state, Some(transition))
                        val color = if orientation == "black" then "black" else "white"
                        val first = ply.getOrElse(frames.last.ply).max(frames.head.ply).min(frames.last.ply)
                        val destination =
                          if analysis then s"/${id.value}/$color/analysis" else s"/${id.value}/$color"
                        def playerName(p: lila.core.game.Player) =
                          lila.game.Namer
                            .recordedPlayerText(p, p.userId.map(env.user.lightUserApi.syncFallback(_)))
                        val players = s"${playerName(game.whitePlayer)} vs. ${playerName(game.blackPlayer)}"
                        val title = (List(players, game.nativeVariant.name) ++ game.clock.map(_.config.show))
                          .mkString(" · ")
                        board(frames, orientation, Some(s"$destination#$first"), Some(first))
                          .copy(title = Some(title))
                )
          case _ => invalid()
      case _ => invalid()

object MsgBoards:
  private case class Source(kind: String, value: String, inline: Boolean):
    def bodyValue = value.replace("\r\n", "\n")
  private case class Marks(ply: Int, fen: String, shapes: Vector[MsgBoard.Shape])
  private case class Draft(source: Source, start: Option[Int], end: Option[Int], marks: Vector[Marks])
  private given Reads[Source] = Json.reads
  private given Reads[Marks] = Json.reads
  private given Reads[Draft] = Json.reads

  private def invalid[A](code: String = "invalidBoard"): Fu[A] = fufail(MsgActionError(code))
  private def requireValid[A](value: Option[A]): Fu[A] = value.fold(invalid[A]())(fuccess)
  private def validSource(source: Source) =
    source.value.trim.nonEmpty && (source.kind match
      case "fen" => source.value.length <= (if source.value.trim.startsWith("TK1;") then 10000 else 200)
      case "pgn" | "record" => source.value.getBytes(UTF_8).length <= 16_000
      case "link" => source.inline && source.value.length <= 2048
      case _ => false)

  private val brushes = Set("green", "red", "blue", "yellow")
  private def validShape(shape: MsgBoard.Shape, fen: String) =
    def valid(key: String) =
      if fen.startsWith("TK1;") then Location.fromKey(key).exists(_.key == key)
      else
        Xiangqi.Square
          .fromKey(key)
          .exists(square =>
            fen.takeWhile(_ != ' ').count(_ == '/') != 6 || (square.file < 7 && square.rank <= 7)
          )
    brushes(shape.brush) &&
    valid(shape.orig) &&
    shape.dest.forall(dest => dest != shape.orig && valid(dest))

  private def kingdomFrame(p: Position, index: Int, action: Option[String]) =
    MsgBoard.Frame(
      PositionCodec.write(p.copy(repetitions = Vector.empty, checkHistory = Vector.empty)),
      index,
      p.turn.color,
      action,
      p.active.exists(Rules.checked(p, _)),
      false,
      false,
      Vector.empty
    )

  private def kingdomBoard(
      initial: Position,
      events: Vector[(Kingdom, String)],
      end: Option[Int],
      start: Option[Int],
      path: Option[String]
  ): Option[MsgBoard] =
    val size = end.getOrElse(events.size)
    Option
      .when(size >= 0 && size <= events.size && size <= 600)(size)
      .flatMap: count =>
        val frames = Vector.newBuilder[MsgBoard.Frame]
        frames += kingdomFrame(initial, 0, None)
        events
          .take(count)
          .zipWithIndex
          .foldLeft(Option(initial)):
            case (previous, ((actor, action), index)) =>
              previous.flatMap: before =>
                Rules
                  .event(before, actor, action)
                  .toOption
                  .map: after =>
                    frames += kingdomFrame(after, index + 1, Some(action)).copy(
                      capture = Move.parse(action).exists(m => before.piece(m.to).nonEmpty),
                      checkmate = after.eliminated.size > before.eliminated.size
                    )
                    after
          .map: _ =>
            val first = start.getOrElse(count).max(0).min(count)
            board(frames.result(), path = path, start = Some(first))

  private def frame(
      state: Xiangqi.State,
      transition: Option[(Xiangqi.Uci, Xiangqi.State)] = None,
      shapes: Vector[XiangqiAnnotations.Shape] = Vector.empty
  ): MsgBoard.Frame =
    MsgBoard.Frame(
      state.fen,
      state.ply,
      state.turn.key,
      transition.map(_._1.value),
      state.check,
      transition.exists((move, before) =>
        Xiangqi.Fen.board(before.fen).exists(_.pieceAt(move.dest).isDefined)
      ),
      state.mate,
      shapes
        .take(32)
        .map:
          case XiangqiAnnotations.Shape.Circle(brush, orig) => MsgBoard.Shape(orig.key, None, brush)
          case XiangqiAnnotations.Shape.Arrow(brush, orig, dest) =>
            MsgBoard.Shape(orig.key, Some(dest.key), brush)
      ,
      state.captures.lastOption
        .filter(_.ply == state.ply)
        .map(c => MsgBoard.Capture(c.side.key, c.square, c.role, c.concealed, c.ply))
    )

  private def board(
      frames: Vector[MsgBoard.Frame],
      orientation: String = "red",
      path: Option[String] = None,
      start: Option[Int] = None
  ) = MsgBoard(frames, orientation, start.getOrElse(frames.head.ply), path, None)

  private sealed trait Link
  private case class Kingdoms(id: GameId, index: Option[Int]) extends Link
  private val kingdomsPath = """/three-kingdoms/game/([a-zA-Z0-9]{8})""".r
  private case class Puzzle(id: PuzzleId) extends Link
  private case class Game(id: GameId, orientation: String, ply: Option[Int], analysis: Boolean) extends Link

  private val puzzlePath = """/(?:[a-z]{2,3}/)?training/(?:[\w-]+/)?([a-zA-Z0-9]{5}|[0-9]{6,})""".r
  private val gamePath =
    """/(?:embed/(?:game/)?)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:/(white|black)(?:/analysis)?)?""".r

  private def link(text: String): Option[Link] =
    val normalized =
      if text.startsWith("http://") || text.startsWith("https://") then text else s"https://$text"
    Try(URI.create(normalized)).toOption
      .filter(uri =>
        Set("http", "https")(uri.getScheme) && uri.getUserInfo == null && uri.getPort == -1 &&
          Option(uri.getHost).exists(host =>
            Set("lixiangqi.com", "www.lixiangqi.com")(host.toLowerCase(java.util.Locale.ROOT))
          )
      )
      .flatMap: uri =>
        uri.getRawPath match
          case kingdomsPath(id) => Some(Kingdoms(GameId(id), Option(uri.getFragment).flatMap(_.toIntOption)))
          case puzzlePath(id) =>
            (if id.length == 5 then Some(PuzzleId(id))
             else id.toLongOption.flatMap(lila.puzzle.Puzzle.numericalId.apply)).map(Puzzle.apply)
          case gamePath(id, color) =>
            Some(
              Game(
                GameId(id),
                if color == "black" then "black" else "red",
                Option(uri.getFragment).flatMap(_.toIntOption),
                uri.getRawPath.endsWith("/analysis")
              )
            )
          case _ => None
