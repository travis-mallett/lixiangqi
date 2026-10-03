package lila.analyse

class XiangqiBookTest extends munit.FunSuite:
  test("CDB coordinates convert only at the external boundary"):
    val result = XiangqiBook.parse("move:i9i8,score:42,rank:2,winrate:51.2,note:! (20-12)").toOption.get.head
    assertEquals(result.move.value, "i10i9")
    assertEquals(result.score, Some(42))
    assertEquals(result.outcome, None)
  test("endgame distances retain the documented metric and outcome"):
    val win = XiangqiBook.parse("move:a0a1,score:29993,rank:2,note:! (W-M-0007)").toOption.get.head
    assertEquals(win.outcome, Some("win"))
    assertEquals(win.distance, Some(7))
    assertEquals(win.loops, None)
    val loss = XiangqiBook.parse("move:a0a1,score:-29993,rank:0,note:? (L-02-0012)").toOption.get.head
    assertEquals(loss.outcome, Some("loss"))
    assertEquals(loss.distance, Some(12))
    assertEquals(loss.loops, Some(2))
  test("unknown positions stay empty and malformed data never becomes a partial result"):
    assertEquals(XiangqiBook.parse("unknown"), Right(Vector.empty))
    assert(XiangqiBook.parse("move:a0a1,score:12|move:i:i9,score:3").isLeft)
    assert(XiangqiBook.parse("move:a0a1,score:12|move:a0a1,score:3").isLeft)
    assert(XiangqiBook.parse("move:a0a1,score:bogus").isLeft)
