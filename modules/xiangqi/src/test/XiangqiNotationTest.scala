package lila.xiangqi

import Xiangqi.*
import lila.xiangqi.adjudication.Ruleset

class XiangqiNotationTest extends munit.FunSuite:

  test("multiple chapter splitting follows notation grammar"):
    val first =
      "[Event \"First\"]\n\n[Site \"Here\"]\n1. b1c3 {note\n\n[Event \"not a chapter\"]} (1. h1g3 *) *"
    val second = "[Event \"Second\"]\n1. i1i2 *"
    assertEquals(XiangqiNotation.splitDocuments(first + "\n\n" + second, 2), Right(Vector(first, second)))
    assert(XiangqiNotation.splitDocuments(first + "\n\n" + second, 1).isLeft)
    assert(XiangqiNotation.splitDocuments("1. b1c3 (1. h1g3 *", 2).isLeft)
    assertEquals(
      XiangqiNotation.splitDocuments("1. b1c3 *\n1. i1i2 *", 2),
      Right(Vector("1. b1c3 *", "1. i1i2 *"))
    )

  private def read(text: String, ruleset: Option[Ruleset] = None): ImportedMoveTree =
    XiangqiNotation.importTree(NotationImport(notation = text, ruleset = ruleset)).fold(fail(_), identity)

  private def rejected(text: String): Unit =
    assert(XiangqiNotation.importTree(NotationImport(notation = text)).isLeft, text)

  test("headers inside comments are preserved as text"):
    val text = """[Event "Native study"]
{
[Variant "Chess"]
}
;[Result "0-1"]
1. i4i5 i7i6 *"""
    val tree = read(text)
    assertEquals(tree.headers, Map("event" -> "Native study", "result" -> "*"))
    assertEquals(tree.annotations.comments.map(_.text), Vector("[Variant \"Chess\"]", "[Result \"0-1\"]"))

  test("adjacent headers, escaped values, and case-insensitive duplicate detection"):
    val tree = read("""[Event "A \"quoted\" title"] [Site "C:\\data"] 1. i4i5""")
    assertEquals(tree.headers("event"), "A \"quoted\" title")
    assertEquals(tree.headers("site"), "C:\\data")
    rejected("""[Event "A"] [event "B"] *""")
    rejected("""1. a4a5 [Event "Late"]""")

  test("invalid headers and escapes fail explicitly"):
    List(
      "[Event unquoted] *",
      "[Event \"Unclosed] *",
      "[1Event \"A\"] *",
      "[Event \"A\\q\"] *",
      "[Variant \"Chess\"] *",
      "[Ruleset \"unknown\"] *",
      "[FEN \"invalid\"] *"
    ).foreach(rejected)

  test("result tokens survive without a Result header and conflicts are errors"):
    assertEquals(read("1. a4a5 a7a6 1-0").headers("result"), "1-0")
    assertEquals(read("""[Result "0-1"] 1. a4a5""").headers("result"), "0-1")
    rejected("""[Result "0-1"] 1. a4a5 1-0""")
    rejected("""[Result "invalid"] *""")
    rejected("1. a4a5 * a7a6")
    rejected("1. a4a5 * *")

  test("root, attached, and variation glyphs are retained"):
    val tree = read("$14 {root} 1.i4i5!$1 ( {alternative} $2 1.a4a5 ?? ) i7i6 !? *")
    assertEquals(tree.glyphs, Vector(14))
    assertEquals(tree.children.map(_.move.value), Vector("i4i5", "a4a5"))
    assertEquals(tree.children.head.glyphs, Vector(1))
    assertEquals(tree.children(1).glyphs, Vector(2, 4))
    assertEquals(tree.children.head.children.head.glyphs, Vector(5))
    List("$bogus *", "$256 *", "$-1 *", "$999999999999999999999 *", "a4a5!!!").foreach(rejected)

  test("duplicate branches merge all their annotations and continuations"):
    val tree = read("a4a5 {first} (a4a5 $2 {second} b10c8) a7a6")
    assertEquals(tree.children.size, 1)
    val first = tree.children.head
    assertEquals(first.annotations.comments.map(_.text), Vector("first", "second"))
    assertEquals(first.glyphs, Vector(2))
    assertEquals(first.children.map(_.move.value), Vector("a7a6", "b10c8"))

  test("a bad variation rejects the whole import instead of returning a prefix"):
    List("a4a5 (a4a6) a7a6", "a4a5 ()", "a4a5 ({orphan comment})", "a4a5 (c4c5", "a4a5 )")
      .foreach(rejected)

  test("move numbering validates the actual side and fullmove"):
    read("1. i4i5 1... i7i6 2. h1g3")
    rejected("2. i4i5")
    rejected("1... i4i5")
    rejected("1. i4i5 1. i7i6")

  test("the complete branch history determines adjudication, including rank ten moves"):
    val cycle = "b1c3 b10c8 c3b1 c8b10"
    val text = Vector.fill(4)(cycle).mkString(" ")
    val restricted = read(text, Some(Ruleset.Tiantian))
    val replay = XiangqiRules
      .game(Position(moves = restricted.mainline.moves, ruleset = Ruleset.Tiantian))
      .fold(fail(_), identity)
    assertEquals(restricted.mainline, replay)
    assertEquals(restricted.mainline.ruleset, Ruleset.Tiantian)
    assert(restricted.mainline.state.ended)
    assertEquals(restricted.mainline.state.gameResult, Result.Draw)
    assert(!read(text).mainline.state.ended)
    assert(
      XiangqiNotation
        .importTree(NotationImport(notation = s"$text b1c3", ruleset = Some(Ruleset.Tiantian)))
        .isLeft
    )

  test("variation replay begins with its ancestors rather than a FEN snapshot"):
    val prefix = Vector.fill(3)("b1c3 b10c8 c3b1 c8b10").mkString(" ")
    val text = s"$prefix b1c3 b10c8 c3b1 (c3e2) c8b10"
    val tree = read(text, Some(Ruleset.Tiantian))
    var parent = tree.children.head
    for _ <- 1 until 14 do parent = parent.children.head
    assertEquals(parent.children.map(_.move.value), Vector("c3b1", "c3e2"))
    assertEquals(parent.children.head.children.head.state.gameResult, Result.Draw)
    val branch = parent.children(1)
    val moves = tree.mainline.moves.take(14) :+ branch.move
    val expected =
      XiangqiRules.position(Position(moves = moves, ruleset = Ruleset.Tiantian)).fold(fail(_), identity)
    assertEquals(branch.state, expected)
    assert(!branch.state.ended)

  test("Ruleset headers and explicit policy agree and survive mainline extraction"):
    assertEquals(read("""[Ruleset "tiantian-v1"] a4a5""").ruleset, Ruleset.Tiantian)
    assert(
      XiangqiNotation
        .importTree(
          NotationImport(
            notation = """[Ruleset "unrestricted-v1"] a4a5""",
            ruleset = Some(Ruleset.Tiantian)
          )
        )
        .isLeft
    )

  test("branch length limits reject input atomically"):
    val moves = Vector.fill(151)("b1c3 b10c8 c3b1 c8b10").mkString(" ")
    assert(
      XiangqiNotation.importTree(NotationImport(notation = moves)).left.toOption.exists(_.contains("600"))
    )

  test("native export round trips nested variations, metadata, root and move annotations"):
    val tree = read("""[Event "Native \"study\""]
[Red "Red participant"]
[Black "Black participant"]
[Result "1-0"]
[CustomTag "preserve this"]
$14 {Root [%csl Gi10] [%eval 0.12,20]}
1. i4i5! {Main [%cal Ri10i9] [%clk 0:01:02.34]}
(1. h1g3 {Alternative} (1. b1c3 {Nested} 1-0) h10g8)
i7i6 1-0""")
    for style <- NotationStyle.values do
      val exported = XiangqiNotation.exportTree(tree, style)
      val imported = read(exported)
      assertEquals(imported.children, tree.children)
      assertEquals(imported.annotations.comments, tree.annotations.comments)
      assertEquals(imported.glyphs, tree.glyphs)
      assertEquals(imported.state, tree.state)
      assertEquals(imported.ruleset, tree.ruleset)
      tree.headers.foreach((name, value) => assertEquals(imported.headers(name), value))

  test("export comments cannot inject moves, headers, or unmatched braces"):
    val root = read("*").copy(annotations =
      XiangqiAnnotations.Parsed(comments =
        Vector("unmatched } and {\n[Result \"1-0\"]\n1. a4a5", "second").map(XiangqiAnnotations.Comment(_))
      )
    )
    val imported = read(XiangqiNotation.exportTree(root))
    assertEquals(imported.annotations.comments, root.annotations.comments)
    assertEquals(imported.headers("result"), "*")
    assertEquals(imported.children, Vector.empty)
