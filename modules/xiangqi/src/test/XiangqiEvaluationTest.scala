package lila.xiangqi

import Xiangqi.*
import lila.xiangqi.adjudication.Ruleset

class XiangqiEvaluationTest extends munit.FunSuite:
  private val cycle = Vector("b1c3", "b10c8", "c3b1", "c8b10").map(Uci.unsafe)
  private def game(position: Position) = XiangqiEvaluation.game(position).toOption.get

  test("cache identity distinguishes policy and full history even when the board is equal"):
    val history = game(Position(moves = cycle, ruleset = Ruleset.Tiantian))
    val snapshot = game(Position(initialFen = history.state.fen, ruleset = Ruleset.Tiantian))
    val unrestricted = game(history.position.copy(ruleset = Ruleset.Unrestricted))
    assertEquals(snapshot.state.fen, history.state.fen)
    assertNotEquals(XiangqiEvaluation.key(history), XiangqiEvaluation.key(snapshot))
    assertNotEquals(XiangqiEvaluation.key(history), XiangqiEvaluation.key(unrestricted))
    assertEquals(XiangqiEvaluation.key(history), XiangqiEvaluation.key(game(history.position)))

  test("batch principal variation uses the branch history and fails atomically"):
    val base = game(Position(moves = cycle ++ cycle ++ cycle, ruleset = Ruleset.Tiantian))
    val line = XiangqiRules.variation(base, cycle).toOption.get
    assertEquals(line.moves.last.state.gameResult, Result.Draw)
    assertEquals(line.moves.last.state.termination, Some("repetition"))
    assert(XiangqiRules.variation(base, cycle :+ cycle.head).isLeft)
    assert(XiangqiRules.variation(base, Vector(Uci.unsafe("i10i9"))).isLeft)

  test("variation coordinates and labels are derived together"):
    val line = XiangqiRules
      .variation(VariationCommand(variation = Vector("i1i2", "i10i9").map(Uci.unsafe)))
      .toOption
      .get
      .moves
    assertEquals(line.map(_.move.value), Vector("i1i2", "i10i9"))
    assert(line.forall(n => n.notation.nonEmpty && n.chineseNotation.nonEmpty))
    assertEquals(line.last.state.ply, 2)

  test("awarded broadcast points preserve double and partial forfeits"):
    for red <- Score.values; black <- Score.values do
      val points = BySide(red, black)
      assertEquals(GamePoints.fromResult(GamePoints.show(Some(points))), Some(points))
    assertEquals(GamePoints.fromResult("*"), None)
    assertEquals(GamePoints.fromResult("1/2-0"), Some(BySide(Score.Half, Score.Zero)))
