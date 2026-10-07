package lila.core.game

import munit.FunSuite

class AiLevelTest extends FunSuite:
  test("names every supported computer level"):
    assertEquals(AiLevel.levels.size, 720)
    AiLevel.levels.foreach: level =>
      assertEquals(AiLevel.name(level), Some(s"Pikafish level $level"))

  test("rejects levels outside the public range"):
    assertEquals(AiLevel.name(0), None)
    assertEquals(AiLevel.name(721), None)
    assertEquals(AiLevel.displayName(721), "AI level 721")
