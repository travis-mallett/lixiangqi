package lila.setup

class RulesetFormTest extends munit.FunSuite:
  test("AI setup defaults to Tiantian and accepts an explicit supported override"):
    val default = SetupForm.api.ai.bind(Map("level" -> "5")).get
    assertEquals(default.effectiveRuleset, lila.xiangqi.adjudication.Ruleset.Tiantian)
    val custom = SetupForm.api.ai.bind(Map("level" -> "5", "ruleset" -> "unrestricted-v1")).get
    assertEquals(custom.effectiveRuleset, lila.xiangqi.adjudication.Ruleset.Unrestricted)

  test("custom challenge and AI APIs reject unimplemented standards"):
    assert(SetupForm.api.ai.bind(Map("level" -> "5", "ruleset" -> "wxf")).hasErrors)
    assert(SetupForm.api.admin.bind(Map("ruleset" -> "national")).hasErrors)
    assert(SetupForm.api.open(isAdmin = false).bind(Map("ruleset" -> "national")).hasErrors)

  test("custom challenge API preserves explicit adjudication selection"):
    val bound = SetupForm.api.admin.bind(Map("ruleset" -> "unrestricted-v1"))
    assertEquals(bound.get.ruleset, Some("unrestricted-v1"))
