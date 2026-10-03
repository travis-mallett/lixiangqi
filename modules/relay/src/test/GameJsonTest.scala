package lila.relay

import chess.format.pgn.{ Tag, Tags }
import scalalib.model.Seconds

class GameJsonTest extends munit.FunSuite:

  test("clock"):
    val clock =
      DgtJson.ClockJson(white = Some(Seconds(4468)), black = Some(Seconds(30)), time = 1734688185870L)

    assertEquals(
      DgtJson.GameJson(Nil, None, Some(clock)).clockTags,
      Tags(
        List(
          Tag("RedClock", "1:14:28.00"),
          Tag("BlackClock", "0:00:30.00")
          // Tag(_.ReferenceTime, "2024-12-20T09:49:45.870Z")
        )
      )
    )

  test("toPgn mini"):

    val moves = List(
      "a4a5",
      "a7a6 1818",
      "h1g3 +19",
      "h10g8 1821+28"
    )

    val expected =
      """a4a5 a7a6 {[%clk 0:30:18.00]} h1g3 {[%emt 0:00:19.00]} h10g8 {[%clk 0:30:21.00] [%emt 0:00:28.00]}"""

    val game = DgtJson.GameJson(moves, None)
    assertEquals(game.toPgn(Tags.empty).value.trim, expected)

  test("malformed clock input is rejected"):
    intercept[IllegalArgumentException]:
      DgtJson.GameJson(List("a4a5 not-a-clock"), None).toPgn(Tags.empty)

  test("custom black-to-move positions attach the reported black clock to the first move"):
    val clock = DgtJson.ClockJson(Some(Seconds(120)), Some(Seconds(90)), 0L)
    val fen = lila.xiangqi.Xiangqi.startFen.replace(" w ", " b ")
    val pgn = DgtJson.GameJson(List("i10i9"), None, Some(clock), Some(fen)).toPgn(Tags.empty)
    val imported = lila.study.StudyPgnImport.result(pgn, Nil).fold(err => fail(err.value), identity)
    assertEquals(imported.root.lastMainlineNode.clock.map(_.centis.value), Some(9000))
