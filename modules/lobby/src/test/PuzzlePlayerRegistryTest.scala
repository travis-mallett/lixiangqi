package lila.lobby

import lila.core.socket.Sri

class PuzzlePlayerRegistryTest extends munit.FunSuite:

  test("counts anonymous puzzle connections"):
    val players = new PuzzlePlayerRegistry

    assertEquals(players.enter(Sri("anon-a"), none, at = 10), Some(1))
    assertEquals(players.enter(Sri("anon-b"), none, at = 10), Some(2))
    assertEquals(players.count, 2)

  test("deduplicates authenticated players across tabs"):
    val players = new PuzzlePlayerRegistry
    val user = UserId("solver")

    assertEquals(players.enter(Sri("tab-a"), user.some, at = 10), Some(1))
    assertEquals(players.enter(Sri("tab-b"), user.some, at = 10), None)
    assertEquals(players.count, 1)

  test("refreshes heartbeats and expires stale connections"):
    val players = new PuzzlePlayerRegistry

    players.enter(Sri("fresh"), none, at = 10)
    assertEquals(players.enter(Sri("fresh"), none, at = 30), None)
    assertEquals(players.expire(before = 20), None)
    assertEquals(players.expire(before = 40), Some(0))
