package lila.xiangqi

import Xiangqi.*

class MoveLabelsTest extends munit.FunSuite:
  test("Jieqi root labels describe movement without choosing a reveal"):
    val labels = XiangqiRules
      .moveLabels(MoveLabelsCommand(Jieqi.startFen, Vector(Uci.unsafe("b10c8"), Uci.unsafe("b1c3"))))
      .toOption
      .get
    assertEquals(labels("b10c8").notation, "h2+3")
    assertEquals(labels("b1c3").notation, "H8+7")
    assert(labels("b10c8").chineseNotation.nonEmpty)

  test("move label batches reject invalid positions, empty origins, and oversized requests"):
    assert(XiangqiRules.moveLabels(MoveLabelsCommand("invalid", Vector.empty)).isLeft)
    assert(XiangqiRules.moveLabels(MoveLabelsCommand(Jieqi.startFen, Vector(Uci.unsafe("a5a6")))).isLeft)
    assert(
      XiangqiRules.moveLabels(MoveLabelsCommand(Jieqi.startFen, Vector.fill(17)(Uci.unsafe("b1c3")))).isLeft
    )
