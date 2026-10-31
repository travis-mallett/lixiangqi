package lila.core.game

import munit.FunSuite

class AiLevelTest extends FunSuite:
  test("main setup has ten exact engine levels, independent of bot progression"):
    assertEquals(AiLevel.customLevels, List(1, 9, 98, 187, 276, 364, 453, 542, 631, 720))
    assert(AiLevel.customLevels.forall(AiLevel.levels.contains))

  test("names every supported computer level"):
    assertEquals(AiLevel.levels.size, 720)
    AiLevel.levels.foreach: level =>
      assertEquals(AiLevel.name(level), Some(s"Pikafish level $level"))

  test("rejects levels outside the public range"):
    assertEquals(AiLevel.name(0), None)
    assertEquals(AiLevel.name(721), None)
    assertEquals(AiLevel.displayName(721), "AI level 721")
