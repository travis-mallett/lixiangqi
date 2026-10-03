package lila.xiangqi

class XiangqiClockControlTest extends munit.FunSuite:
  test("TimeControl seconds and increments are independent of the source website"):
    val control = XiangqiClockControl.parse("60+2").toOption.flatten.get
    assertEquals(control.initial, 6000)
    assertEquals(control.creditAfterMove(1), 200)

  test("staged and repeating controls allocate time at the completed move boundary"):
    val staged = XiangqiClockControl.parse("40/7200:3600+30").toOption.flatten.get
    assertEquals(staged.creditAfterMove(39), 0)
    assertEquals(staged.creditAfterMove(40), 360000)
    assertEquals(staged.creditAfterMove(41), 3000)
    val repeated = XiangqiClockControl.parse("40/7200").toOption.flatten.get
    assertEquals(repeated.creditAfterMove(80), 720000)
    assert(XiangqiClockControl.parse("0/60").isLeft)
    assert(XiangqiClockControl.parse("60:60").isLeft)
    assertEquals(XiangqiClockControl.parse("?"), Right(None))
