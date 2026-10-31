package lila.setup

class MobileAiFormTest extends munit.FunSuite:
  private val fields = Map(
    "variant" -> "1",
    "timeMode" -> "0",
    "time" -> "5",
    "increment" -> "3",
    "days" -> "2",
    "level" -> "1",
    "color" -> "random",
    "ruleset" -> "tiantian-v1"
  )

  test("mobile setup accepts exactly the ten main difficulties"):
    lila.core.game.AiLevel.customLevels.foreach: level =>
      assertEquals(SetupForm.mobileAi.bind(fields.updated("level", level.toString)).get.level, level)
    List(0, 2, 8, 721).foreach: level =>
      assert(SetupForm.mobileAi.bind(fields.updated("level", level.toString)).hasErrors)

  test("side, repetition rules, game clock and both move limits are retained"):
    val game = SetupForm.mobileAi
      .bind(
        fields ++ Map(
          "color" -> "black",
          "ruleset" -> "unrestricted-v1",
          "timeMode" -> "1",
          "time" -> "1.5",
          "moveTime.seconds" -> "90",
          "moveTime.firstMoves" -> "3",
          "moveTime.firstSeconds" -> "30"
        )
      )
      .get
    assertEquals(game.color.name, "black")
    assertEquals(game.ruleset, Some("unrestricted-v1"))
    assertEquals(game.time, 1.5d)
    assertEquals(game.moveTimeLimit.map(_.seconds), Some(90))
    assertEquals(game.moveTimeLimit.flatMap(_.first).map(_.moves), Some(3))

  test("correspondence, invalid clocks and strict from-position constraints"):
    assert(!SetupForm.mobileAi.bind(fields ++ Map("timeMode" -> "2", "days" -> "14")).hasErrors)
    assert(
      SetupForm.mobileAi.bind(fields ++ Map("timeMode" -> "1", "time" -> "0", "increment" -> "0")).hasErrors
    )
    assert(SetupForm.mobileAi.bind(fields ++ Map("variant" -> "3", "fen" -> "bad")).hasErrors)
    assert(
      SetupForm.mobileAi
        .bind(
          fields ++ Map(
            "variant" -> "3",
            "fen" -> lila.xiangqi.Xiangqi.startFen,
            "timeMode" -> "1",
            "time" -> "0.5"
          )
        )
        .hasErrors
    )
    assert(
      !SetupForm.mobileAi
        .bind(
          fields ++ Map(
            "variant" -> "3",
            "fen" -> lila.xiangqi.Xiangqi.startFen,
            "timeMode" -> "1",
            "time" -> "1"
          )
        )
        .hasErrors
    )
