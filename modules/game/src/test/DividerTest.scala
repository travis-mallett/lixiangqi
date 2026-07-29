package lila.game

import lila.xiangqi.Xiangqi

class DividerTest extends munit.FunSuite:

  given Executor = scala.concurrent.ExecutionContextOpportunistic

  private val developed =
    "r1bakab1r/9/1cn3nc1/p1p1p1p1p/9/9/P1P1P1P1P/1CN3NC1/9/R1BAKAB1R w - - 4 3"
  private val endgame = "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1"

  test("divides Xiangqi positions by development and attacking material"):
    val division = Divider()(GameId("division"), Vector(Xiangqi.startFen, developed, endgame))
    assertEquals(division.middle.map(_.value), Some(1))
    assertEquals(division.end.map(_.value), Some(2))
    assertEquals(division.plies.value, 3)

  test("does not run malformed Xiangqi positions through scalachess"):
    val division = Divider()(GameId("malformd"), Vector(Xiangqi.startFen, "not a Xiangqi FEN"))
    assertEquals(division, chess.Division.empty)
