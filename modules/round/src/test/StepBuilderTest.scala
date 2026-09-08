package lila.round

import lila.xiangqi.{ SpecialRulesExamples, Xiangqi, XiangqiRules }
import Xiangqi.*

class StepBuilderTest extends munit.FunSuite:

  test("a checking move that reaches the natural draw limit never becomes replay checkmate"):
    val root = XiangqiRules
      .initialGame(
        Some(SpecialRulesExamples.singlePiece.initialFen),
        SpecialRulesExamples.singlePiece.ruleset
      )
      .toOption
      .get
    val seeded = root.copy(states =
      Vector(
        root.state.copy(
          adjudication = root.state.adjudication.map(_.copy(naturalPlies = 119))
        )
      )
    )
    val move = XiangqiRules.move(seeded, SpecialRulesExamples.singlePiece.moves.head).toOption.get
    val game = seeded.applyMove(move).toOption.get
    assertEquals(game.state.termination, Some("no-capture"))
    val step = StepBuilder(game).value.last
    assertEquals((step \ "check").as[Boolean], true)
    assertEquals((step \ "mate").as[Boolean], false)

  test("an actual board checkmate remains marked for replay"):
    val root = XiangqiRules
      .initialGame(Some("4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1"))
      .toOption
      .get
    val move = XiangqiRules.move(root, Uci.unsafe("a3e3")).toOption.get
    val game = root.applyMove(move).toOption.get
    assertEquals(game.state.termination, Some("checkmate"))
    assertEquals((StepBuilder(game).value.last \ "mate").as[Boolean], true)
