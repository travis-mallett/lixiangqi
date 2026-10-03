package lila.study

import lila.xiangqi.XiangqiGlyph.{ Glyph, Glyphs }

import chess.format.pgn.{ Tag, Tags }
import chess.format.Fen
import lila.xiangqi.UciPath
import lila.xiangqi.XiangqiJson.given
import lila.xiangqi.Xiangqi.Uci

import chess.{ Centis, Ply }
import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.Xiangqi.{ Square, Side, Move, BySide }
import lila.xiangqi.adjudication.Ruleset
import chess.eval.*
import reactivemongo.api.bson.*

import scala.util.Success

import lila.db.BSON
import lila.db.BSON.{ Reader, Writer }
import lila.db.dsl.{ *, given }
import lila.tree.Node.{ Comment, Comments, Gamebook, Shape, Shapes }
import lila.tree.{ Branch, Branches, Root, Clock }

object BSONHandlers:

  given BSONHandler[Square] = tryHandler[Square](
    { case BSONString(v) => Square.fromKey(v).toTry(s"Invalid Xiangqi square: $v") },
    x => BSONString(x.key)
  )
  given BSONHandler[Side] = tryHandler[Side](
    { case BSONString(v) => Side.fromKey(v).left.map(error => new IllegalArgumentException(error)).toTry },
    x => BSONString(x.key)
  )
  given BSONHandler[Xiangqi.RecordedResult] = tryHandler[Xiangqi.RecordedResult](
    { case BSONString(v) =>
      Xiangqi.RecordedResult.fromKey(v).left.map(error => new IllegalArgumentException(error)).toTry
    },
    x => BSONString(x.key)
  )
  given BSONHandler[Ruleset] = tryHandler[Ruleset](
    { case BSONString(v) => Ruleset.fromKey(v).left.map(error => new IllegalArgumentException(error)).toTry },
    x => BSONString(x.key)
  )
  given BSONHandler[UciPath] = tryHandler[UciPath](
    { case BSONString(v) => UciPath.from(v).left.map(error => new IllegalArgumentException(error)).toTry },
    x => BSONString(x.value)
  )

  given BSON[Shape] with
    def reads(r: Reader) =
      val brush = r.str("b")
      r.getO[Square]("p")
        .map(Shape.Circle(brush, _))
        .getOrElse(Shape.Arrow(brush, r.get[Square]("o"), r.get[Square]("d")))
    def writes(w: Writer, t: Shape) =
      t match
        case Shape.Circle(brush, pos) => $doc("b" -> brush, "p" -> pos.key)
        case Shape.Arrow(brush, orig, dest) => $doc("b" -> brush, "o" -> orig.key, "d" -> dest.key)

  given BSONHandler[Uci] = tryHandler[Uci](
    { case BSONString(v) => Uci.from(v).left.map(error => new IllegalArgumentException(error)).toTry },
    x => BSONString(x.value)
  )

  given BSONDocumentHandler[Xiangqi.Position] = Macros.handler

  given studyIdNameHandler: BSONDocumentHandler[lila.core.study.IdName] = Macros.handler
  given chapterIdNameHandler: BSONDocumentHandler[Chapter.IdName] = Macros.handler

  given BSON[Comment.Author] with
    def reads(r: Reader) = r.str("kind") match
      case "site" => Comment.Author.Site
      case "unknown" => Comment.Author.Unknown
      case "external" => Comment.Author.External(r.str("name"))
      case "user" => Comment.Author.User(r.get[UserId]("id"), r.str("name"))
      case kind => throw IllegalArgumentException(s"Invalid comment author kind: $kind")
    def writes(w: Writer, author: Comment.Author) = author match
      case Comment.Author.User(id, name) => $doc("kind" -> "user", "id" -> id, "name" -> name)
      case Comment.Author.External(name) => $doc("kind" -> "external", "name" -> name)
      case Comment.Author.Site => $doc("kind" -> "site")
      case Comment.Author.Unknown => $doc("kind" -> "unknown")
  given BSONDocumentHandler[Comment] = Macros.handler

  given BSONDocumentHandler[Gamebook] = Macros.handler

  given BSONDocumentHandler[Clock] = Macros.handler

  given BSONHandler[Glyphs] =
    val intReader = collectionReader[List, Int]
    tryHandler[Glyphs](
      { case arr: Barr =>
        intReader.readTry(arr).map(ints => Glyphs.fromIds(ints))
      },
      x => BSONArray(x.toList.map(_.id).map(BSONInteger.apply))
    )

  given BSONHandler[Score] =
    val mateFactor = 1000000
    BSONIntegerHandler.as[Score](
      v =>
        if v >= mateFactor || v <= -mateFactor then Score.mate(v / mateFactor)
        else Score.cp(v),
      _.fold(
        cp => cp.value.atLeast(-mateFactor + 1).atMost(mateFactor - 1),
        mate => mate.value * mateFactor
      )
    )

  // Stored move identity is authoritative. Rehydrate against the complete parent game,
  // validating persisted derivatives rather than trusting an unrelated FEN snapshot.
  private[study] def readBranch(doc: Bdoc, game: Xiangqi.Game): (Branch, Xiangqi.Game) =
    import Node.BsonFields as F
    val r = Reader(doc)
    val uci = r.get[Uci](F.uci)
    val result = XiangqiRules.move(game, uci).fold(error => throw IllegalArgumentException(error), identity)
    require(r.get[Ply](F.ply).value == result.ply, s"Invalid ply for ${uci.value}")
    require(r.get[Fen.Full](F.fen).value == result.fen, s"Invalid stored position for ${uci.value}")
    require(r.str(F.notation) == result.notation, s"Invalid stored notation for ${uci.value}")
    require(
      r.str(F.chineseNotation) == result.chineseNotation,
      s"Invalid stored Chinese notation for ${uci.value}"
    )
    val branch = Branch(
      state = result.state,
      result = r.getO[Xiangqi.RecordedResult](F.result),
      elapsed = r.getO[Centis](F.elapsed),
      evaluationDepth = r.getO[Int](F.evaluationDepth),
      move = Move(uci, result.notation, result.chineseNotation),
      shapes = r.getO[Shapes](F.shapes).getOrElse(Shapes.empty),
      comments = r.getO[Comments](F.comments).getOrElse(Comments.empty),
      gamebook = r.getO[Gamebook](F.gamebook),
      glyphs = r.getO[Glyphs](F.glyphs).getOrElse(Glyphs.empty),
      eval = r.getO[Score](F.score).map(lila.tree.evals.fromScore),
      clock = r.getO[Clock](F.clock),
      forceVariation = r.getO[Boolean](F.forceVariation).getOrElse(false),
      comp = r.getO[Boolean](F.comp).getOrElse(false)
    )
    branch -> game.applyMove(result).fold(error => throw IllegalArgumentException(error), identity)

  private[study] def writeBranch(n: Branch) =
    import Node.BsonFields as F
    val w = new Writer
    $doc(
      F.ply -> n.ply,
      F.order -> n.children.toList.map(_.id),
      F.result -> n.result,
      F.elapsed -> n.elapsed,
      F.evaluationDepth -> n.evaluationDepth,
      F.uci -> n.move.uci,
      F.notation -> n.move.notation,
      F.chineseNotation -> n.move.chineseNotation,
      F.fen -> n.fen,
      F.shapes -> n.shapes.value.nonEmpty.option(n.shapes),
      F.comments -> n.comments.value.nonEmpty.option(n.comments),
      F.gamebook -> n.gamebook,
      F.glyphs -> n.glyphs.nonEmpty,
      F.score -> n.eval.flatMap(_.score),
      F.clock -> n.clock,
      F.forceVariation -> w.boolO(n.forceVariation),
      F.comp -> w.boolO(n.comp)
    )

  private[study] given BSON[Root] with
    import Node.BsonFields as F
    def reads(fullReader: Reader) =
      val r = Reader(fullReader.doc.getAsOpt[Bdoc](UciPathDb.rootDbKey).err("Missing root"))
      val fen = r.get[Fen.Full](F.fen)
      val ruleset = r.get[Ruleset](F.ruleset)
      val game = XiangqiRules
        .initialGame(Some(fen.value), ruleset)
        .fold(error => throw IllegalArgumentException(error), identity)
      require(r.get[Ply](F.ply).value == game.state.ply, "Invalid study root ply")
      Root(
        state = game.state,
        result = r.getO[Xiangqi.RecordedResult](F.result),
        elapsed = r.getO[Centis](F.elapsed),
        evaluationDepth = r.getO[Int](F.evaluationDepth),
        ruleset = ruleset,
        shapes = r.getO[Shapes](F.shapes) | Shapes.empty,
        comments = r.getO[Comments](F.comments) | Comments.empty,
        gamebook = r.getO[Gamebook](F.gamebook),
        glyphs = r.getO[Glyphs](F.glyphs) | Glyphs.empty,
        eval = r.getO[Score](F.score).map(lila.tree.evals.fromScore),
        clock = r.getO[Clock](F.clock),
        children = StudyFlatTree.reader.rootChildren(fullReader.doc, game)
      )
    def writes(w: Writer, r: Root) = $doc(
      StudyFlatTree.writer.rootChildren(r).appended {
        UciPathDb.rootDbKey -> $doc(
          F.ply -> r.ply,
          F.order -> r.children.toList.map(_.id),
          F.result -> r.result,
          F.elapsed -> r.elapsed,
          F.evaluationDepth -> r.evaluationDepth,
          F.fen -> r.fen,
          F.ruleset -> r.ruleset,
          F.shapes -> r.shapes.value.nonEmpty.option(r.shapes),
          F.comments -> r.comments.value.nonEmpty.option(r.comments),
          F.gamebook -> r.gamebook,
          F.glyphs -> r.glyphs.nonEmpty,
          F.score -> r.eval.flatMap(_.score),
          F.clock -> r.clock
        )
      }
    )

  given BSONHandler[Tag] = tryHandler[Tag](
    { case BSONString(v) =>
      v.split(":", 2) match
        case Array(name, value) => Success(Tag(name, value))
        case _ => handlerBadValue(s"Invalid pgn tag $v")
    },
    t => BSONString(s"${t.name}:${t.value}")
  )
  given (using handler: BSONHandler[List[Tag]]): BSONHandler[Tags] = handler.as[Tags](Tags.apply, _.value)
  private given BSONDocumentHandler[Chapter.Setup] = Macros.handler
  private given BSONHandler[PairOf[Option[lila.core.playerDirectory.PlayerId]]] = optionTupleHandler
  given BSONDocumentHandler[Chapter.Relay] = Macros.handler
  given BSONDocumentHandler[Chapter.ServerEval] = Macros.handler

  private val clockPair: BSONHandler[PairOf[Option[Centis]]] = optionTupleHandler
  given BSONHandler[Chapter.BothClocks] = clockPair.as[Chapter.BothClocks](BySide.fromPair, _.toPair)
  given BSONHandler[Chapter.Check] = quickHandler[Chapter.Check](
    { case BSONString(v) => if v == "#" then Chapter.Check.Mate else Chapter.Check.Check },
    v => BSONString(if v == Chapter.Check.Mate then "#" else "+")
  )
  given BSON[Chapter.LastPosDenorm] with
    def reads(r: Reader) = Chapter.LastPosDenorm(
      fen = r.get[Fen.Full]("fen"),
      uci = r.getO[Uci]("uci"),
      check = r.getO[Chapter.Check]("check"),
      clocks = ~r.getO[Chapter.BothClocks]("clocks"),
      position = r.get[Xiangqi.Position]("position")
    )
    def writes(w: Writer, l: Chapter.LastPosDenorm) = $doc(
      "fen" -> l.fen,
      "position" -> l.position,
      "uci" -> l.uci,
      "check" -> l.check,
      "clocks" -> l.clocks.some.filter(_.exists(_.isDefined))
    )

  given BSONDocumentHandler[Chapter] = Macros.handler

  given BSONHandler[Position.Ref] = tryHandler(
    { case BSONString(v) => Position.Ref.decode(v).toTry(s"Invalid position $v") },
    x => BSONString(x.encode)
  )
  given studyRoleHandler: BSONHandler[StudyMember.Role] = tryHandler(
    { case BSONString(v) => StudyMember.Role.byId.get(v).toTry(s"Invalid role $v") },
    x => BSONString(x.id)
  )
  private[study] case class DbMember(role: StudyMember.Role)
  private[study] given dbMemberHandler: BSONDocumentHandler[DbMember] = Macros.handler
  private[study] given BSONDocumentWriter[StudyMember] with
    def writeTry(x: StudyMember) = Success($doc("role" -> x.role))

  private[study] given (using handler: BSONHandler[Map[String, DbMember]]): BSONHandler[StudyMembers] =
    handler.as[StudyMembers](
      members =>
        StudyMembers(members.map { (id, dbMember) =>
          UserId(id) -> StudyMember(UserId(id), dbMember.role)
        }),
      _.members.view.map((id, m) => id.value -> DbMember(m.role)).toMap
    )

  import lila.core.study.Visibility
  given visibilityHandler: BSONHandler[Visibility] = tryHandler[Visibility](
    { case BSONString(v) => Visibility.byKey.get(v).toTry(s"Invalid visibility $v") },
    v => BSONString(v.toString)
  )
  import Study.From
  private[study] given BSONHandler[From] = tryHandler[From](
    { case BSONString(v) =>
      v.split(' ') match
        case Array("scratch") => Success(From.Scratch)
        case Array("game", id) => Success(From.Game(GameId(id)))
        case Array("study", id) => Success(From.Study(StudyId(id)))
        case Array("relay") => Success(From.Relay(none))
        case Array("relay", id) => Success(From.Relay(StudyId(id).some))
        case _ => handlerBadValue(s"Invalid from $v")
    },
    x =>
      BSONString(x match
        case From.Scratch => "scratch"
        case From.Game(id) => s"game $id"
        case From.Study(id) => s"study $id"
        case From.Relay(id) => s"relay${id.fold("")(" " + _)}")
  )
  import Settings.UserSelection
  private[study] given BSONHandler[UserSelection] = tryHandler[UserSelection](
    { case BSONString(v) => UserSelection.byKey.get(v).toTry(s"Invalid user selection $v") },
    x => BSONString(x.key)
  )
  given BSON[Settings] with
    def reads(r: Reader) =
      Settings(
        computer = r.get[UserSelection]("computer"),
        explorer = r.get[UserSelection]("explorer"),
        cloneable = r.getO[UserSelection]("cloneable") | Settings.init.cloneable,
        shareable = r.getO[UserSelection]("shareable") | Settings.init.shareable,
        chat = r.getO[UserSelection]("chat") | Settings.init.chat,
        sticky = r.getO[Boolean]("sticky") | Settings.init.sticky,
        description = r.getO[Boolean]("description") | Settings.init.description
      )
    private val writer = Macros.writer[Settings]
    def writes(w: Writer, s: Settings) = writer.writeTry(s).get

  given studyHandler: BSONDocumentHandler[Study] = Macros.handler

  given BSONDocumentReader[Study.LightStudy] with
    def readDocument(doc: BSONDocument) =
      Success(
        Study.LightStudy(
          isPublic = doc.string("visibility").has("public"),
          contributors = doc.getAsOpt[StudyMembers]("members").so(_.contributorIds)
        )
      )
