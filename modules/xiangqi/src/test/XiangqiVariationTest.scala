package lila.xiangqi

import Xiangqi.*
import lila.xiangqi.adjudication.Ruleset

class XiangqiVariationTest extends munit.FunSuite:

  private val cycle = Vector("b1c3", "b10c8", "c3b1", "c8b10").map(Uci.unsafe)

  test("principal variations remain valid beyond the tree path history limit"):
    val moves = Vector.fill(151)(cycle).flatten
    val game = XiangqiRules
      .game(Position(moves = moves, ruleset = Ruleset.Unrestricted))
      .fold(fail(_), identity)
    val result = XiangqiRules.variation(game, cycle).fold(fail(_), identity)
    val expected = XiangqiRules
      .game(Position(moves = moves ++ cycle, ruleset = Ruleset.Unrestricted))
      .fold(fail(_), identity)
    assertEquals(result.moves.last.state, expected.state)
    assert(XiangqiRules.variation(game, Vector(Uci.unsafe("a4a6"))).isLeft)
    assert(XiangqiRules.variation(game, Vector.fill(65)(cycle).flatten).isLeft)
    assert(
      XiangqiRules
        .variation(VariationCommand(moves = moves, variation = cycle, ruleset = Ruleset.Unrestricted))
        .isLeft
    )

  test("variations retain the adjudication history"):
    val game = XiangqiRules
      .game(Position(moves = Vector.fill(3)(cycle).flatten, ruleset = Ruleset.Tiantian))
      .fold(fail(_), identity)
    val result = XiangqiRules.variation(game, cycle).fold(fail(_), identity)
    assertEquals(result.moves.last.state.gameResult, Result.Draw)
    assert(XiangqiRules.variation(game, cycle :+ cycle.head).isLeft)
