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

  test("duel setup binds only rules belonging to the selected board, across all time modes"):
    import lila.xiangqi.GameVariant
    import lila.xiangqi.adjudication.Ruleset
    given Option[lila.core.user.Me] = None
    for
      board <- GameVariant.values
      mode <- TimeMode.values
    do
      val web = Map(
        "gameVariant" -> board.key,
        "variant" -> "1",
        "timeMode" -> mode.id.toString,
        "time" -> "10",
        "increment" -> "0",
        "days" -> "2",
        "level" -> "5",
        "color" -> "random"
      )
      val api = Map("gameVariant" -> board.key, "level" -> "5") ++ (mode match
        case TimeMode.RealTime => Map("clock.limit" -> "600", "clock.increment" -> "0")
        case TimeMode.Correspondence => Map("days" -> "2")
        case TimeMode.Unlimited => Map.empty[String, String])
      for choice <- None :: Ruleset.values.toList.map(Some(_)) do
        val rule = choice.map(r => "ruleset" -> r.key).toMap
        val valid = board.playerCount == 2 && choice.forall(board.supportsRuleset)
        val configs = List(
          SetupForm.friend.bind(web ++ rule).value,
          SetupForm.ai.bind(web ++ rule).value,
          SetupForm.api.admin.bind(api ++ rule).value,
          SetupForm.api.open(false).bind(api ++ rule).value,
          SetupForm.api.ai.bind(api ++ rule).value
        )
        configs.foreach: config =>
          assertEquals(config.map(_.gameVariant), Option.when(valid)(board), s"$board $mode $choice")
          assertEquals(
            config.map(_.effectiveRuleset),
            Option.when(valid)(choice.getOrElse(board.defaultRuleset))
          )
        val hook = SetupForm.hook.bind(web ++ rule)
        assertEquals(
          hook.value.map(_.gameVariant),
          Option.when(board.playerCount == 2 && choice.forall(_ == board.defaultRuleset))(board)
        )

  test("the board API rejects native selectors its standard-only seek cannot honor"):
    for board <- lila.xiangqi.GameVariant.values do
      val requested = Map("gameVariant" -> board.key, "ruleset" -> board.defaultRuleset.key)
      assertEquals(
        SetupForm.boardApiHook(true).bind(requested).hasErrors,
        board != lila.xiangqi.GameVariant.Xiangqi
      )
