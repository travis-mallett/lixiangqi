package lila.xiangqi

import Xiangqi.*

class JieqiNotationTest extends munit.FunSuite:
  private def fixture(name: String): String =
    val source = scala.io.Source.fromResource(s"jieqi-fPL0UJju-$name.pgn")
    try source.mkString
    finally source.close()

  private def read(text: String): ImportedMoveTree =
    XiangqiNotation.importTree(NotationImport(notation = text)).fold(fail(_), identity)

  test("the original fPL0UJju export must not guess an ambiguous pawn move"):
    val result = XiangqiNotation.importTree(NotationImport(notation = fixture("export")))
    assert(result.left.toOption.exists(_.contains("ply 21")))

  test("Chinese export preserves recorded identity when display labels are ambiguous"):
    val tree = read(fixture("coordinate"))
    val exported = XiangqiNotation.exportTree(tree, NotationStyle.Chinese)
    val imported = read(exported)
    assertEquals(imported.mainline.moves, tree.mainline.moves)
    assertEquals(imported.mainline.states, tree.mainline.states)
    assert(exported.contains("c4c5~cannon"))

  test("fPL0UJju exports and reimports the authoritative moves and reveals"):
    // Coordinates and reveals are from the public JSON export, not inferred from ambiguous WXF.
    val tree = read(fixture("coordinate"))
    val game = tree.mainline
    assertEquals(game.moves.size, 90)
    assertEquals(game.moves(20).value, "c4c5")
    assertEquals(game.states(21).reveal, Some("cannon"))
    assertEquals(game.wxf(20), "17+1")
    val beforeAmbiguity = game.copy(
      moves = game.moves.take(20),
      wxf = game.wxf.take(20),
      states = game.states.take(21)
    )
    assertEquals(
      XiangqiRules.notationCandidates(beforeAmbiguity, "+P+1").map(_.toSet),
      Right(Set(Uci.unsafe("c4c5"), Uci.unsafe("e4e5")))
    )
    assert(XiangqiRules.resolveNotation(beforeAmbiguity, "+P+1").isLeft)
    assert(XiangqiRules.resolveNotation(beforeAmbiguity, "前兵进一").isLeft)
    val imported = read(XiangqiNotation.exportTree(tree))
    assertEquals(imported.mainline.moves, game.moves)
    assertEquals(imported.mainline.states, game.states)
    assertEquals(imported.mainline.state.gameResult.key, "0-1")

  test("WXF retains the file for two tandem pawn groups for either side"):
    for
      (fen, moves) <- List(
        "5k3/9/9/9/P1P6/P1P6/9/9/9/4K4 w j - 0 1" ->
          List("a6a7" -> "19+1", "c6c7" -> "17+1"),
        "5k3/9/9/9/p1p6/p1p6/9/9/9/4K4 b j - 0 1" ->
          List("a5a4" -> "11+1", "c5c4" -> "13+1")
      )
      (coordinate, notation) <- moves
      variant <- List("j", "-")
    do
      val initialFen = fen.replace(" j ", s" $variant ")
      val game = XiangqiRules.game(Position(initialFen = initialFen)).fold(fail(_), identity)
      val move = Uci.unsafe(coordinate)
      assertEquals(XiangqiRules.wxf(initialFen, move), Right(notation))
      assertEquals(XiangqiRules.resolveNotation(game, notation), Right(move))

  test("one tandem pawn file retains front and rear notation"):
    val fen = "5k3/9/P8/9/P1P6/9/9/9/9/4K4 w j - 0 1"
    val game = XiangqiRules.game(Position(initialFen = fen)).fold(fail(_), identity)
    for (coordinate, notation) <- List("a8a9" -> "+P+1", "a6a7" -> "-P+1") do
      val move = Uci.unsafe(coordinate)
      assertEquals(XiangqiRules.wxf(fen, move), Right(notation))
      assertEquals(XiangqiRules.resolveNotation(game, notation), Right(move))

  test("game and study exports regenerate legacy cached labels from recorded coordinates"):
    val tree = read(fixture("coordinate"))
    val game = tree.mainline
    val legacy = game.copy(wxf = game.wxf.updated(20, "+P+1").updated(60, "+P+1"))
    val moves = XiangqiNotation.exportMoves(legacy)
    assertEquals(moves(20), "17+1~cannon")
    val importedGame = read(s"""[Variant "Jieqi"] [Ruleset "jieqi-v1"] ${moves.mkString(" ")} 0-1""")
    assertEquals(importedGame.mainline.moves, game.moves)
    assertEquals(importedGame.mainline.states, game.states)

    def oldLabels(nodes: Vector[ImportedTreeNode]): Vector[ImportedTreeNode] = nodes.map: node =>
      node.copy(
        notation = if Set(21, 61)(node.state.ply) then "+P+1" else node.notation,
        children = oldLabels(node.children)
      )
    val importedStudy = read(XiangqiNotation.exportTree(tree.copy(children = oldLabels(tree.children))))
    assertEquals(importedStudy.mainline.moves, game.moves)
    assertEquals(importedStudy.mainline.states, game.states)

  test("server export rejects coordinates paired with another recorded position"):
    val tree = read(fixture("coordinate"))
    val first = tree.children.head
    intercept[IllegalArgumentException]:
      XiangqiNotation.exportTree(tree.copy(children = Vector(first.copy(move = Uci.unsafe("a4a5")))))
    val game = tree.mainline
    intercept[IllegalArgumentException]:
      XiangqiNotation.exportMoves(game.copy(moves = game.moves.updated(0, Uci.unsafe("a4a5"))))

  test("forced historical Jieqi labels retain move identity, reveal and independent results"):
    // This exact PGN is checked against both browser full-document exporters.
    val browserExport = fixture("forced-browser")
    assert(
      XiangqiNotation
        .importTree(
          NotationImport(notation =
            browserExport.replace("""{"kind":"external","name":"Author"}""", """"Author"""")
          )
        )
        .isLeft
    )
    val tree = read(browserExport)
    assertEquals(tree.children.map(_.move.value), Vector("c4c5", "e4e5"))
    assertEquals(tree.children.map(_.result.map(_.key)), Vector(Some("1-0"), Some("*")))
    assert(tree.children.forall(_.annotations.study.exists(_.forceVariation)))
    assert(tree.children.forall(_.state.reveal.contains("cannon")))
    val comment = XiangqiAnnotations.Comment(
      "Preserve the recorded reveal",
      Some("legacy"),
      Some(XiangqiAnnotations.Author("external", name = Some("Author")))
    )
    tree.children.foreach(node => assertEquals(node.annotations.comments, Vector(comment)))
    val historical = tree.copy(children = tree.children.map(_.copy(notation = "+P+1")))
    for style <- NotationStyle.values do
      val exported = XiangqiNotation.exportTree(historical, style)
      assert(!exported.contains("+P+1"))
      assert(!exported.contains("~cannon~cannon"))
      assert(exported.contains("[%nodeResult 1-0]"))
      val restored = read(exported)
      assertEquals(restored.children, tree.children)
      assertEquals(restored.headers("result"), "0-1")
      assertEquals(restored.mainline.moves.size, 0)
      val invalid =
        historical.copy(children = Vector(historical.children.head.copy(move = Uci.unsafe("e4e5"))))
      intercept[IllegalArgumentException]:
        XiangqiNotation.exportTree(invalid, style)
