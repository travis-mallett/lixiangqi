package controllers.inbox

import java.net.URI
import java.nio.charset.StandardCharsets.UTF_8
import scala.util.Try

import play.api.libs.json.*

import lila.app.*
import lila.core.id.PuzzleId
import lila.msg.{ MsgActionError, MsgBoard }
import lila.xiangqi.{ Xiangqi, XiangqiAnnotations, XiangqiNotation, XiangqiRules }

private[inbox] final class MsgBoards(env: Env):
  import MsgBoards.*

  private given Executor = env.executor
  private val limit = lila.memo.RateLimit[UserId](40, 5.minutes, "msg.boards")(using env.net.rateLimit)

  def preview(value: JsValue)(using me: Me): Fu[MsgBoard] =
    requireValid(value.asOpt[Source].filter(validSource)).flatMap: source =>
      limit(me.userId, invalid[MsgBoard]("limited")):
        load(source, None)

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
                draft.marks.forall(_.shapes.forall(validShape))
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
                board.copy(
                  start = start,
                  inline =
                    Option.when(draft.source.inline)(lila.common.String.softCleanUp(draft.source.bodyValue)),
                  frames = board.frames.map(frame =>
                    frame.copy(shapes = (frame.shapes ++ marks.getOrElse(frame.ply, Vector.empty)).distinct)
                  )
                )
            )

  private def load(source: Source, end: Option[Int]): Fu[MsgBoard] =
    val text = source.value.trim.stripPrefix("\ufeff")
    source.kind match
      case "fen" =>
        requireValid(
          XiangqiRules
            .position(Xiangqi.Position(initialFen = text))
            .toOption
            .filter(standard)
            .map: state =>
              board(Vector(frame(state)))
        )
      case "pgn" =>
        requireValid(
          XiangqiNotation
            .importTree(Xiangqi.NotationImport(notation = text))
            .toOption
            .filter(tree => standard(tree.state))
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
              )
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
                    .filter(standard)
                    .map(state => board(Vector(frame(state)), state.turn.key, Some(s"/training/${id.value}")))
                )
          case Some(Game(id, orientation, ply, analysis)) =>
            env.game.gameRepo
              .game(id)
              .flatMap: game =>
                requireValid(
                  game
                    .filter(g => g.started && g.nativeVariant.key == "xiangqi")
                    .flatMap: game =>
                      val history = game.xiangqi
                      val states = history.states.takeWhile(state => end.forall(state.ply <= _))
                      Option.when(states.nonEmpty && end.forall(states.last.ply == _) && states.size <= 601):
                        val frames = frame(states.head) +: states.tail
                          .zip(history.moves.zip(states))
                          .map: (state, transition) =>
                            frame(state, Some(transition))
                        val color = if orientation == "black" then "black" else "white"
                        val first = ply.getOrElse(frames.last.ply).max(frames.head.ply).min(frames.last.ply)
                        val destination =
                          if analysis then s"/${id.value}/$color/analysis" else s"/${id.value}/$color"
                        board(frames, orientation, Some(s"$destination#$first"), Some(first))
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
      case "fen" => source.value.length <= 200
      case "pgn" => source.value.getBytes(UTF_8).length <= 16_000
      case "link" => source.inline && source.value.length <= 2048
      case _ => false)

  private val brushes = Set("green", "red", "blue", "yellow")
  private def validShape(shape: MsgBoard.Shape) =
    brushes(shape.brush) &&
      Xiangqi.Square.fromKey(shape.orig).isDefined &&
      shape.dest.forall(dest => dest != shape.orig && Xiangqi.Square.fromKey(dest).isDefined)

  private def standard(state: Xiangqi.State) = state.variant == "xiangqi"

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
    )

  private def board(
      frames: Vector[MsgBoard.Frame],
      orientation: String = "red",
      path: Option[String] = None,
      start: Option[Int] = None
  ) = MsgBoard(frames, orientation, start.getOrElse(frames.head.ply), path, None)

  private sealed trait Link
  private case class Puzzle(id: PuzzleId) extends Link
  private case class Game(id: GameId, orientation: String, ply: Option[Int], analysis: Boolean) extends Link

  private val puzzlePath = """/(?:[a-z]{2,3}/)?training/(?:[\w-]+/)?([a-zA-Z0-9]{5}|[0-9]{6,})""".r
  private val gamePath = """/(?:embed/(?:game/)?)?([a-zA-Z0-9]{8})(?:/(white|black)(?:/analysis)?)?""".r

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
