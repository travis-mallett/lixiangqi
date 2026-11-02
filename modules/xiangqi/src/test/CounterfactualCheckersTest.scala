package lila.xiangqi

class CounterfactualCheckersTest extends munit.FunSuite:
  test("counterfactual checks use the same native attacks without NNUE placement restrictions"):
    // e8 is not a reachable advisor square. Motif proofs may nevertheless inspect its occupancy.
    val before = "9/4k4/4a4/9/9/4R4/9/9/9/3KC4 w - - 0 1"
    val after = "9/4k4/4a4/9/9/R8/9/9/9/3KC4 b - - 1 1"
    assertEquals(XiangqiRules.checkers(before), Right(Vector.empty))
    assertEquals(XiangqiRules.checkers(after), Right(Vector("e1")))

  test("malformed boards cannot enter attack inspection"):
    assert(XiangqiRules.checkers("invalid").isLeft)
