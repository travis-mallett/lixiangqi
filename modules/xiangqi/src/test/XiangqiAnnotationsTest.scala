package lila.xiangqi

import play.api.libs.json.Json

import Xiangqi.*
import XiangqiAnnotations.*
import XiangqiJson.given

class XiangqiAnnotationsTest extends munit.FunSuite:
  test("attributed comments preserve identity, author, text and ordering"):
    val parsed = Parsed(comments =
      Vector(
        Comment("External text"),
        Comment(
          "Literal [%eval 1.0] ] { 红 }",
          Some("own1"),
          Some(Author("user", Some("owner"), Some("Owner")))
        ),
        Comment("Same name as site", Some("ext1"), Some(Author("external", name = Some("lixiangqi")))),
        Comment("Engine comment", Some("site"), Some(Author("site")))
      )
    )
    assertEquals(XiangqiAnnotations.parse(render(parsed)), Right(parsed))
    assert(
      XiangqiAnnotations.parse(render(parsed.copy(comments = parsed.comments ++ parsed.comments))).isLeft
    )
    assert(
      XiangqiAnnotations
        .parse(
          Vector("[%comment {\"id\":\"bad\",\"text\":\"Text\",\"by\":{\"kind\":\"unknown\",\"extra\":true}}]")
        )
        .isLeft
    )

  test("study teaching directives preserve brackets quotes braces and newlines"):
    val parsed = XiangqiAnnotations.Parsed(study =
      Some(
        XiangqiAnnotations.Study(
          forceVariation = true,
          gamebook = Some(XiangqiAnnotations.Gamebook(Some("Try ] again \"红\"\n{line}"), Some("Hint \\ ["))),
          computer = true,
          clockTrust = Some(false)
        )
      )
    )
    assertEquals(XiangqiAnnotations.parse(XiangqiAnnotations.render(parsed)), Right(parsed))
    assert(XiangqiAnnotations.parse(Vector("[%study {\"forceVariation\":\"yes\"}]")).isLeft)
    assert(XiangqiAnnotations.parse(Vector("[%study {\"extra\":true}]")).isLeft)

  private def parse(text: String): Parsed = XiangqiAnnotations.parse(Vector(text)).fold(fail(_), identity)

  test("arrows and circles cover every intersection without substitutions"):
    for square <- Square.all do
      val original = Parsed(shapes =
        Vector(
          Shape.Circle("green", square),
          Shape.Arrow("red", square, Square(8, 10))
        )
      )
      assertEquals(XiangqiAnnotations.parse(render(original)), Right(original))
    val shapes = parse("[%csl Gi10][%csl Ra10][%cal Bh10g8,Yi10i9]").shapes
    assertEquals(shapes.size, 4)
    assertEquals(shapes.last, Shape.Arrow("yellow", Square(8, 10), Square(8, 9)))

  test("unknown directives survive while supported structured annotations are extracted"):
    val parsed = parse("Text [%unknown keep this] [%clk 0:01:02.34] [%emt 0:00:01.56] [%eval -0.23,19]")
    assertEquals(parsed.comments.map(_.text), Vector("Text [%unknown keep this]"))
    assertEquals(parsed.clock, Some(6234))
    assertEquals(parsed.elapsed, Some(156))
    assertEquals(parsed.evaluation, Some(Evaluation(Some(-23), None, Some(19))))
    assertEquals(XiangqiAnnotations.parse(render(parsed)), Right(parsed))

  test("mate evaluations and maximum clocks round trip"):
    val parsed = Parsed(clock = Some(Int.MaxValue), evaluation = Some(Evaluation(None, Some(-7), Some(30))))
    assertEquals(XiangqiAnnotations.parse(render(parsed)), Right(parsed))
    assertEquals(parse("[%clk 2:10.33]").clock, Some(783300))
    assertEquals(parse("[%clk 0:00:00.005]").clock, Some(1))

  test("malformed supported annotations never disappear silently"):
    List(
      "[%csl Gi:]",
      "[%csl Ga01]",
      "[%csl Xi10]",
      "[%csl Gi10,]",
      "[%cal Gi10]",
      "[%cal Gi10j10]",
      "[%csl]",
      "[%cal Gi10i9",
      "[%clk 0:60:00]",
      "[%clk -1:00:00]",
      "[%clk 999999999:00:00]",
      "[%eval #bad]",
      "[%eval 0.123]",
      "[%eval 1.0,-2]",
      "[%eval 1.0,2,3]",
      "[%clk 0:00:01][%clk 0:00:02]",
      "[%eval 1.0][%eval 2.0]"
    ).foreach(text => assert(XiangqiAnnotations.parse(Vector(text)).isLeft, text))

  test("native shape JSON validates all coordinates and emits native keys"):
    val shape: Shape = Shape.Arrow("blue", Square(0, 10), Square(8, 10))
    assertEquals(Json.toJson(shape), Json.obj("brush" -> "blue", "orig" -> "a10", "dest" -> "i10"))
    assertEquals(Json.toJson(shape).as[Shape], shape)
    assert(Json.obj("brush" -> "blue", "orig" -> "a10", "dest" -> "i:").validate[Shape].isError)

  test("an invalid annotation causes the complete native import to fail"):
    val result = XiangqiNotation.importTree(NotationImport(notation = "a4a5 (c4c5 {[%cal Gi10j10]}) a7a6"))
    assert(result.isLeft)
