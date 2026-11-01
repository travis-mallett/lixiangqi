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

  test("a BOM does not make empty notation importable"):
    List("", " ", "\t\r\n ").foreach: whitespace =>
      val empty = XiangqiNotation.importTree(NotationImport(notation = whitespace))
      assertEquals(empty, Left("Notation must be a non-empty string"))
      assertEquals(XiangqiNotation.importTree(NotationImport(notation = "\uFEFF" + whitespace)), empty)

  test("a BOM does not create an empty document when splitting"):
    List("", " ", "\t\r\n ").foreach: whitespace =>
      assertEquals(XiangqiNotation.splitDocuments(whitespace, 2), Right(Vector.empty[String]))
      assertEquals(XiangqiNotation.splitDocuments("\uFEFF" + whitespace, 2), Right(Vector.empty[String]))

  test("a document-leading BOM does not change imported notation"):
    List(
      "1. P9+1 *",
      "[Event \"BOM import\"]\n\n1. P9+1 *",
      "\n{opening} 1. P9+1 (1. P7+1 *) *"
    ).foreach: text =>
      assertEquals(read("\uFEFF" + text), read(text))
      assertEquals(XiangqiNotation.parseHeaders("\uFEFF" + text), XiangqiNotation.parseHeaders(text))

  test("document splitting preserves offsets after a leading BOM"):
    val first = "\uFEFF[Event \"First\"]\n1. P9+1 *"
    val second = "[Event \"Second\"]\n1. P7+1 *"
    val documents = XiangqiNotation.splitDocuments(first + "\n\n" + second, 2)
    assertEquals(documents, Right(Vector(first, second)))
    documents.toOption.get.foreach(read(_))

  test("BOM handling is limited to the beginning of the document"):
    rejected("1. \uFEFFP9+1 *")
    rejected("\uFEFF\uFEFF1. P9+1 *")
    val tree = read("[Event \"A\uFEFFB\"] {C\uFEFFD} 1. P9+1 *")
    assertEquals(tree.headers("event"), "A\uFEFFB")
    assertEquals(tree.annotations.comments.map(_.text), Vector("C\uFEFFD"))

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

  test("escaped multiline headers preserve exact content and complete trees"):
    val base = read("{Root} 1. i4i5! {Main} (1. h1g3 {Alternative} h10g8) i7i6 *")
    val values = List("", "Legacy single line", "象棋 lesson", "literal \\n and \\r") ++
      List("\n", "\r\n", "\r").map: newline =>
        List("", "First \"quoted\" line \\ path", "", "[Event \"inside the value\"]", "1. a4a5 *", "")
          .mkString(newline)
    for value <- values; style <- NotationStyle.values do
      val tree = base.copy(headers = base.headers.updated("chapterdescription", value))
      val exported = XiangqiNotation.exportTree(tree, style)
      val restored = read(exported)
      assertEquals(restored.headers("chapterdescription"), value)
      assertEquals(restored.copy(headers = tree.headers), tree)
      assertEquals(XiangqiNotation.parseHeaders(exported), Right(restored.headers))
      assertEquals(XiangqiNotation.exportTree(restored, style), exported)
      assert(!exported.contains('\r'))
      assertEquals(exported.linesIterator.count(_.startsWith("[chapterdescription ")), 1)

  test("header escapes decode once and follow the canonical browser export representation"):
    val encoded = """[chapterdescription "象棋\nline\r\nnext\rlast \\n \\r \"quote\" \\"] 1. i4i5 i7i6 *"""
    val decoded = "象棋\nline\r\nnext\rlast \\n \\r \"quote\" \\"
    val tree = read(encoded)
    assertEquals(tree.headers("chapterdescription"), decoded)
    assert(XiangqiNotation.exportTree(tree).contains(encoded.takeWhile(_ != ']')))
    List("[Event \"bad\\q\"] *", "[Event \"bad\\t\"] *", "[Event \"trailing\\").foreach(rejected)

  test("raw multiline headers reject the whole input even when a later quote could close them"):
    val first = "[Event \"First\"]\n1. a4a5 a7a6 *\n\n"
    for
      newline <- List("\n", "\r\n", "\r")
      broken <- List(
        s"[ChapterDescription \"unfinished${newline}1. i4i5 i7i6 *",
        s"[ChapterDescription \"unfinished${newline}[Event \"\"]\n1. i4i5 i7i6 *",
        s"[ChapterDescription \"unfinished${newline}1. i4i5 i7i6 *${newline}\"]\n[Event \"Next\"]\n1. c4c5 c7c6 *",
        s"[ChapterDescription \"first${newline}second\"]\n1. i4i5 i7i6 *"
      )
      text <- List(broken, first + broken)
    do
      rejected(text)
      assert(XiangqiNotation.parseHeaders(text).isLeft)
      assert(XiangqiNotation.splitDocuments(text, 3).isLeft)

  test("escaped descriptions cannot create phantom chapter boundaries"):
    val trees = List("\n", "\r\n", "\r").map: newline =>
      read("1. i4i5 i7i6 *").copy(headers =
        Map(
          "chapterdescription" -> List("First", "[Event \"inside\"]", "1. a4a5 *", "").mkString(newline)
        )
      )
    val exported = trees.map(XiangqiNotation.exportTree(_))
    val documents = XiangqiNotation.splitDocuments(exported.mkString("\n"), 3).fold(fail(_), identity)
    assertEquals(documents, exported.map(_.trim).toVector)
    documents
      .zip(trees)
      .foreach: (document, tree) =>
        val restored = read(document)
        assertEquals(restored.headers("chapterdescription"), tree.headers("chapterdescription"))
        assertEquals(restored.children, tree.children)
    assert(XiangqiNotation.splitDocuments(exported.mkString("\n"), 2).isLeft)

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

  test("browser forced-only fixture round trips every node result, annotation and sibling in both styles"):
    val text = scala.util.Using.resource(getClass.getResourceAsStream("/forced-variations.pgn")): stream =>
      new String(stream.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)
    val tree = read(text)
    assertEquals(tree.headers("result"), "0-1")
    assertEquals(tree.mainline.moves.size, 0)
    assertEquals(tree.children.map(_.move.value), Vector("a4a5", "i4i5"))
    assert(tree.children.forall(_.annotations.study.exists(_.forceVariation)))
    val first = tree.children.head
    assertEquals(first.result.map(_.key), Some("1-0"))
    assertEquals(tree.children(1).result.map(_.key), Some("1/2-0"))
    assertEquals(first.children.map(_.move.value), Vector("a7a6", "c7c6"))
    assert(first.children.forall(_.annotations.study.exists(_.forceVariation)))
    assertEquals(first.children.map(_.result.map(_.key)), Vector(Some("0-1"), Some("*")))
    assertEquals(first.children.head.children.head.result.map(_.key), Some("1/2-1/2"))
    assertEquals(first.annotations.clock, Some(1234))
    assertEquals(first.annotations.elapsed, Some(20))
    assertEquals(first.annotations.comments.head.text, "Keep [%nodeResult 0-0] as text")
    assertEquals(first.annotations.comments.head.by.map(_.name), Some(Some("Author")))
    assertEquals(first.annotations.evaluation.map(_.depth), Some(Some(18)))
    assertEquals(first.glyphs, Vector(1))
    assertEquals(first.annotations.shapes.size, 1)
    assertEquals(first.annotations.study.flatMap(_.clockTrust), Some(false))
    assert(first.annotations.nodeResult.isEmpty)
    for style <- NotationStyle.values do
      val exported = XiangqiNotation.exportTree(tree, style)
      val restored = read(exported)
      assertEquals(restored, tree.copy(headers = restored.headers))
      assertEquals(restored.headers("result"), "0-1")
      assertEquals(restored.mainline.moves.size, 0)
      assertEquals(XiangqiNotation.exportTree(restored, style), exported)
      assertEquals(XiangqiNotation.splitDocuments(exported + "\n" + exported, 2).map(_.size), Right(2))
    val mixed = tree.copy(children =
      tree.children
        .updated(1, tree.children(1).copy(annotations = tree.children(1).annotations.copy(study = None)))
    )
    val mixedRestored = read(XiangqiNotation.exportTree(mixed))
    assertEquals(mixedRestored.children, mixed.children)
    assertEquals(mixedRestored.mainline.moves.map(_.value), Vector("i4i5", "i7i6"))

  test("node result metadata is strict and compatible with existing branch termination markers"):
    val legacy = read("1. a4a5 (1. i4i5 1-0) *")
    val explicit = read("1. a4a5 (1. i4i5 {[%nodeResult 1-0]} 1-0) *")
    assertEquals(explicit, legacy)
    assertEquals(read(XiangqiNotation.exportTree(legacy)).children, legacy.children)
    List(
      "{[%nodeResult 1-0]} *",
      "1. a4a5 {[%nodeResult]} *",
      "1. a4a5 {[%nodeResult invalid]} *",
      "1. a4a5 {[%nodeResult 1-0 0-1]} *",
      "1. a4a5 {[%nodeResult 1-0] [%nodeResult 0-1]} *",
      "1. a4a5 (1. i4i5 {[%nodeResult 0-1]} 1-0) *"
    ).foreach(rejected)
    val distinct = read("[Result \"0-1\"] 1. a4a5 {[%nodeResult 1-0]} 0-1")
    assertEquals(distinct.children.head.result.map(_.key), Some("1-0"))
    assertEquals(distinct.headers("result"), "0-1")
    assertEquals(read(XiangqiNotation.exportTree(distinct)).children, distinct.children)

  test("forced single moves at a black custom start preserve explicit ongoing results"):
    val fen = startFen.replace("w - - 0 1", "b - - 0 20")
    val tree = read(s"""[FEN "$fen"]
20... a7a6 {[%study {"forceVariation":true}] [%nodeResult *]} *""")
    assertEquals(tree.mainline.moves.size, 0)
    assertEquals(tree.children.head.result.map(_.key), Some("*"))
    assertEquals(read(XiangqiNotation.exportTree(tree)).children, tree.children)
