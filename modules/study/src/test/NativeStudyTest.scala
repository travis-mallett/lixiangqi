package lila.study

import chess.format.pgn.{ PgnStr, Tags }
import play.api.libs.json.*
import reactivemongo.api.bson.*
import lila.tree.{ Root, Branches }
import lila.tree.Node.{ Shape, Shapes }
import lila.xiangqi.{ Xiangqi, XiangqiRules, UciPath }
import lila.xiangqi.XiangqiJson.given
import lila.xiangqi.adjudication.Ruleset

class NativeStudyTest extends munit.FunSuite:
  import BSONHandlers.given
  private def imported(text: String) =
    StudyPgnImport.result(PgnStr(text), Nil).fold(e => fail(e.value), identity)
  private def path(text: String) = UciPath(text)
  private val notation = """[Red "Alice"]
[Black "Bob"]
[Event "Native study"]
[CustomData "Keep me"]
[Result "*"]
{Root [%csl Gi10][%cal Ri10i9][%clk 0:03:00.25][%eval 0.32,18]} $1
1. i1i2 {Main [%clk 0:02:59.87][%emt 0:00:00.38]} (1. a1a2 {Alternative} a10a9) i10i9
(1... b10c8 {Nested [%cal Bi10i1]} 2. a1a2) 2. i2i3 *
"""

  test("native identity preserves file i, rank ten, branches and annotation metadata"):
    val value = imported(notation)
    assertEquals(value.root.children.toList.map(_.id.value), List("i1i2", "a1a2"))
    val branch = value.root.nodeAt(path("i1i2/i10i9")).get
    assertEquals(branch.moveOption.get.uci.value, "i10i9")
    assertEquals(value.root.clock.get.centis.value, 18025)
    assertEquals(value.root.eval.get.cp.get.value, 32)
    assertEquals(value.root.evaluationDepth, Some(18))
    assertEquals(value.root.glyphs.toList.map(_.id), List(1))
    assertEquals(value.tags("customdata"), Some("Keep me"))
    assertEquals(value.root.shapes.value.size, 2)

  test("BSON flat targeted paths and import-export round trip preserve full semantics"):
    val value = imported(notation)
    val handler = summon[BSONHandler[Root]]
    val document = handler.writeTry(value.root).get.asInstanceOf[BSONDocument]
    assert(document.contains("i1i2/i10i9/i2i3"))
    val restored = handler.readTry(document).get
    assertEquals(restored, value.root)
    val exported = PgnDump.rootToPgn(restored, value.tags)(using PgnDump.fullFlags)
    val reimported = imported(exported.value)
    val exportedAgain = PgnDump.rootToPgn(reimported.root, reimported.tags)(using PgnDump.fullFlags)
    assertEquals(exportedAgain, exported)

  test("illegal variations and corrupted paths are explicit errors"):
    assert(StudyPgnImport.result(PgnStr("1. a4a5 (1. i1i10)"), Nil).isLeft)
    assert(StudyPgnImport.result(PgnStr("1. a4a5 {[%cal Gi10z9]}"), Nil).isLeft)
    List("a4a5/", "/a4a5", "a4a5//a7a6", "i:i9", "a1a2garbage").foreach(p => assert(UciPath.from(p).isLeft))

  test("malformed persisted moves and orphan nodes fail without truncation"):
    val root = imported("1. a4a5 a7a6").root
    val handler = summon[BSONHandler[Root]]
    val document = handler.writeTry(root).get.asInstanceOf[BSONDocument]
    val first = document.getAsOpt[BSONDocument]("a4a5").get
    val corrupt = document ++ BSONDocument("a4a5" -> (first ++ BSONDocument("u" -> "a4a10")))
    assert(handler.readTry(corrupt).isFailure)
    val orphan =
      BSONDocument(document.elements.toList.filterNot(_.name == "a4a5").map(e => e.name -> e.value))
    assert(handler.readTry(orphan).isFailure)

  test("move creation uses full branch adjudication history"):
    val example = lila.xiangqi.SpecialRulesExamples.singlePiece
    val notation = s"[FEN \"${example.initialFen}\"]\n[Ruleset \"${example.ruleset.key}\"]\n" + example.moves
      .take(12)
      .map(_.value)
      .mkString(" ")
    val value = imported(notation)
    val path = value.root.mainlinePath
    val game = value.root.gameAt(path).toOption.get
    assertEquals(game.moves, path.computeIds)
    assertEquals(game.ruleset, Ruleset.Tiantian)
    assert(XiangqiRules.move(game, example.moves(12)).isLeft)
    val snapshot = Xiangqi.Position(initialFen = game.state.fen)
    assert(XiangqiRules.move(snapshot, example.moves(12)).isRight)

  test("JSON has native literal identities, state and notation without chess adapters"):
    val root = imported("1. i1i2 i10i9").root
    val js = Json.toJson(root)(using lila.tree.Node.defaultNodeJsonWriter)
    assertEquals((js \ "ruleset").as[String], "unrestricted-v1")
    val first = (js \ "children")(0)
    assertEquals((first \ "id").as[String], "i1i2")
    assert((first \ "notation").asOpt[String].isDefined)
    assert((first \ "san").isEmpty)
    assertEquals((first \ "state" \ "turn").as[String], "black")

  test("duplicate insertion preserves sibling ordering and annotations"):
    val root = imported("1. a4a5 (1. c4c5)").root
    val duplicate = root.children.toList.head
    val next = root.addChild(duplicate)
    assertEquals(next.children.toList.map(_.id), root.children.toList.map(_.id))

  test("promotion, forced variations, delete and custom start ply use canonical paths"):
    val root = imported("1. a4a5 (1. c4c5)").root
    val promoted = root.withChildren(_.promoteToMainlineAt(path("c4c5"))).get
    assertEquals(promoted.mainlinePath, path("c4c5"))
    val forced = promoted.forceVariationAt(true, path("c4c5")).get
    assertEquals(forced.mainlinePath, path("a4a5"))
    val deleted = forced.withChildren(_.deleteNodeAt(path("c4c5"))).get
    assertEquals(deleted.children.toList.size, 1)
    val custom =
      Root.fromPosition(Xiangqi.Position(initialFen = Xiangqi.startFen.replace("0 1", "0 20"))).toOption.get
    assertEquals(custom.lastMainlinePly.value, 38)

  test("offline analysis migration resolves native notation with full source context"):
    val position = Xiangqi.Position(moves = Vector(Xiangqi.Uci.unsafe("a4a5")))
    assertEquals(lila.tree.NativeAnalysisMigration.convert("12,,P9+1,a4a5", position), Right("12,,a4a5,a4a5"))
    assert(lila.tree.NativeAnalysisMigration.convert("12,,Qh5,a4a5", position).isLeft)

  test("offline analysis migration resolves ambiguous pawns only from recorded evidence"):
    val position = Xiangqi.Position(
      initialFen = "4k4/9/9/9/9/2p1p4/9/2p1p4/9/5K3 b - - 0 1",
      moves = Vector(Xiangqi.Uci.unsafe("e3d3"))
    )
    val game = XiangqiRules.game(position.copy(moves = Vector.empty)).toOption.get
    assert(XiangqiRules.resolveNotation(game, "+p=4").isLeft)
    assertEquals(
      XiangqiRules.notationCandidates(game, "+p=4").toOption.get.toSet,
      Set(Xiangqi.Uci.unsafe("c3d3"), Xiangqi.Uci.unsafe("e3d3"))
    )
    assertEquals(
      lila.tree.NativeAnalysisMigration.convert("12,,+p=4,e3d3", position),
      Right("12,,e3d3,e3d3")
    )
    assertEquals(
      lila.tree.NativeAnalysisMigration.convert("12,,+p=4 K4=5 p5+1", position),
      Right("12,,e3d3 f1e1 e5e4")
    )
    assert(lila.tree.NativeAnalysisMigration.convert("12,,+p=4", position).isLeft)
    assert(lila.tree.NativeAnalysisMigration.convert("12,,+p=4,e5e4", position).isLeft)

  test("native child order survives physical BSON field reordering"):
    val root = imported("1. a4a5 (1. c4c5) (1. i4i5)").root
      .withChildren(_.promoteToMainlineAt(path("i4i5")))
      .get
    val handler = summon[BSONHandler[Root]]
    val document = handler.writeTry(root).get.asInstanceOf[BSONDocument]
    val shuffled = BSONDocument(document.elements.toList.reverse.map(e => e.name -> e.value))
    assertEquals(handler.readTry(shuffled).get.children.toList.map(_.id), root.children.toList.map(_.id))
    val missingOrder = shuffled ++ BSONDocument(
      "_" ->
        (shuffled.getAsTry[BSONDocument]("_").get ++ BSONDocument("o" -> BSONArray("a4a5")))
    )
    assert(handler.readTry(missingOrder).isFailure)

  test("elapsed clocks follow each branch and explicit clocks retain precedence"):
    val root = imported("""[TimeControl "60+2"]
1. a4a5 {[%emt 0:00:03]} (1. c4c5 {[%emt 0:00:10]}) a7a6 {[%clk 0:00:58]} 2. a5a6 {[%emt 0:00:04]}
""").root
    assertEquals(root.clock.get.centis.value, 6000)
    assertEquals(root.nodeAt(path("a4a5")).get.clock.get.centis.value, 5900)
    assertEquals(root.nodeAt(path("c4c5")).get.clock.get.centis.value, 5200)
    assertEquals(root.nodeAt(path("a4a5/a7a6/a5a6")).get.clock.get.centis.value, 5700)
    assert(StudyPgnImport.result(PgnStr("[TimeControl \"1\"] 1. a4a5 {[%emt 0:00:03]}"), Nil).isLeft)

  test("teaching, forced variations, numeric glyphs and chapter metadata round trip"):
    val root = imported("1. a4a5 $255 (1. c4c5 $0)").root
      .setGamebookAt(
        lila.tree.Node.Gamebook(Some("Try [again] \"红\"\n{variation}"), Some("Hint \\ ]")),
        UciPath.root
      )
      .get
      .forceVariationAt(true, path("a4a5"))
      .get
    val tags = Tags(
      List(
        chess.format.pgn.Tag("ChapterMode", "conceal"),
        chess.format.pgn.Tag("ConcealPly", "1"),
        chess.format.pgn.Tag("Orientation", "black"),
        chess.format.pgn.Tag("ChapterDescription", "Lesson description")
      )
    )
    val restored = imported(PgnDump.rootToPgn(root, tags)(using PgnDump.fullFlags).value)
    assertEquals(restored.root.gamebook, root.gamebook)
    assertEquals(restored.root.mainlinePath, path("c4c5"))
    assertEquals(restored.root.children.toList.map(_.glyphs.toList.map(_.id)), List(List(255), List(0)))
    assertEquals(restored.metadata.mode, Some(ChapterMaker.Mode.Conceal))
    assertEquals(restored.metadata.conceal.map(_.value), Some(1))
    assertEquals(restored.metadata.orientation, Some(Xiangqi.Side.Black))
    assertEquals(restored.metadata.description, Some("Lesson description"))

  test("native positions retain history and repeated source annotation merges are idempotent"):
    val source = imported("1. a4a5 {A} a7a6 {B}").root
    val fromPosition =
      Root.fromPosition(Xiangqi.Position(moves = source.mainlinePath.computeIds)).toOption.get
    assertEquals(fromPosition.mainlinePath, source.mainlinePath)
    assertEquals(fromPosition.gameAt(source.mainlinePath).toOption.get.moves, source.mainlinePath.computeIds)
    val same = imported("1. a4a5 {A} a7a6 {B}").root
    assertEquals(source.merge(same), source)

  test("conflicting external participant aliases fail explicitly"):
    assert(StudyPgnImport.result(PgnStr("[White \"A\"] [Red \"B\"] 1. a4a5"), Nil).isLeft)
    assertEquals(imported("[White \"A\"] [Red \"A\"] 1. a4a5").tags("Red"), Some("A"))

  test("GIF frames retain both native clocks including the root"):
    val value = imported("[TimeControl \"60\"] 1. i1i2 {[%clk 0:00:59.25]} i10i9 {[%clk 0:00:58.50]}")
    val chapter = Chapter(
      StudyChapterId("chapter1"),
      StudyId("study001"),
      StudyChapterName("Clocks"),
      Chapter.Setup(None, Xiangqi.Side.Red),
      value.root,
      value.tags,
      1,
      UserId("owner"),
      createdAt = nowInstant
    )
    val frames = GifExport.frames(chapter, true).value
    assertEquals((frames(0) \ "clock" \ "red").as[Int], 6000)
    assertEquals((frames(0) \ "clock" \ "black").as[Int], 6000)
    assertEquals((frames(1) \ "clock" \ "red").as[Int], 5925)
    assertEquals((frames(1) \ "clock" \ "black").as[Int], 6000)
    assertEquals((frames(2) \ "clock" \ "red").as[Int], 5925)
    assertEquals((frames(2) \ "clock" \ "black").as[Int], 5850)

  test("canonical full-tree transport preserves forced sibling order and all 600 plies"):
    val forced = imported("1. a4a5 (1. c4c5)").root.forceVariationAt(true, path("a4a5")).get
    val ordered = lila.tree.Node.writeJson(forced)
    assertEquals(
      (ordered \ "children").as[JsArray].value.map(child => (child \ "id").as[String]).toList,
      List("a4a5", "c4c5")
    )
    val moves = Vector.fill(150)(Vector("b1c3", "b10c8", "c3b1", "c8b10")).flatten.map(Xiangqi.Uci.unsafe)
    val root = Root
      .fromPosition(Xiangqi.Position(moves = moves, ruleset = lila.xiangqi.adjudication.Ruleset.Unrestricted))
      .toOption
      .get
    var json: JsValue = lila.tree.Node.writeJson(root)
    // Full trees are outbound browser data. Play's bounded request parser is not
    // the consumer; retain its lower inbound limit while checking every emitted move.
    val encoded = Json.stringify(json)
    assertEquals("\"uci\":".r.findAllMatchIn(encoded).size, 600)
    var count = 0
    while (json \ "children").as[JsArray].value.nonEmpty do
      json = (json \ "children")(0)
      count += 1
    assertEquals(count, 600)

  test("notation round trip preserves every contributor and comment identity"):
    import lila.tree.Node.{ Comment, Comments }
    val comments = List(
      Comment(
        Comment.Id("own1"),
        chess.format.pgn.Comment("Owner {literal} [%eval 1.0]"),
        Comment.Author.User(UserId("owner"), "Owner")
      ),
      Comment(
        Comment.Id("con1"),
        chess.format.pgn.Comment("Contributor"),
        Comment.Author.User(UserId("contributor"), "Contributor")
      ),
      Comment(Comment.Id("ext1"), chess.format.pgn.Comment("External"), Comment.Author.External("lixiangqi")),
      Comment(Comment.Id("sit1"), chess.format.pgn.Comment("Engine"), Comment.Author.Site)
    )
    val root = imported("1. a4a5").root.copy(comments = Comments(comments))
    val restored = imported(PgnDump.rootToPgn(root, Tags.empty)(using PgnDump.fullFlags).value).root
    assertEquals(restored.comments, root.comments)
