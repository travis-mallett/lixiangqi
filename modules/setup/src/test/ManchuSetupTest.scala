package lila.setup

import munit.FunSuite
import lila.xiangqi.GameVariant
import lila.xiangqi.adjudication.Ruleset

class ManchuSetupTest extends FunSuite:
  private val fields = Map(
    "variant" -> "1",
    "gameVariant" -> "manchu",
    "timeMode" -> "1",
    "time" -> "10",
    "increment" -> "0",
    "days" -> "2",
    "level" -> "1",
    "color" -> "random"
  )

  test("computer setup accepts all ten Manchu+ levels and uses its own default rules"):
    for level <- 1 to 10 do
      val config = SetupForm.ai.bind(fields.updated("level", level.toString)).get
      assertEquals(config.gameVariant, GameVariant.Manchu)
      assertEquals(config.effectiveRuleset, Ruleset.Manchu)
      assertEquals(config.level, level)
    for level <- List(0, 11, 720) do
      assert(SetupForm.ai.bind(fields.updated("level", level.toString)).hasErrors)

  test("friend setup preserves Manchu+ and never creates a rated challenge"):
    given Option[lila.core.user.Me] = None
    val config = SetupForm.friend.bind(fields - "level").get
    assertEquals(config.gameVariant, GameVariant.Manchu)
    assertEquals(config.effectiveRuleset, Ruleset.Manchu)

  test("custom positions must match the selected native variant"):
    assert(
      !SetupForm.ai
        .bind(fields ++ Map("variant" -> "3", "fen" -> lila.xiangqi.ManchuRules.startFen))
        .hasErrors
    )
    assert(
      SetupForm.ai.bind(fields ++ Map("variant" -> "3", "fen" -> lila.xiangqi.Xiangqi.startFen)).hasErrors
    )
