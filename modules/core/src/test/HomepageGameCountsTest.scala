package lila.core.pool

import lila.core.game.Source

class HomepageGameCountsTest extends munit.FunSuite:

  test("homepage occupancy combines waiting people and active-game participants"):
    val room = PoolConfigId("15+0-m90-30x3")
    val counts = HomepageGameCounts(Map(room -> 2), friendGames = 3, aiGames = 4, lobbyPlayers = 5)

    assertEquals(counts.poolPlayers(room, waitingPlayers = 1), 5)
    assertEquals(counts.friendPlayers, 6)
    assertEquals(counts.aiPlayers, 4)
    assertEquals(counts.lobbyPlayers, 5)

  test("a room without active games reports only its waiting people"):
    val room = PoolConfigId("5+0-m60-30x3")
    val counts = HomepageGameCounts(Map.empty, friendGames = 0, aiGames = 0, lobbyPlayers = 0)

    assertEquals(counts.poolPlayers(room, waitingPlayers = 2), 2)

  test("only exact homepage-room games are excluded from the Lobby total"):
    val room = PoolConfigId("15+0-m90-30x3")
    val empty = HomepageGameCounts(Map.empty, friendGames = 0, aiGames = 0, lobbyPlayers = 0)

    val homepageGame =
      empty.updateActiveGame(Some(room), Some(Source.Pool), humanPlayers = 2, delta = 1)
    assertEquals(homepageGame.poolPlayers(room, waitingPlayers = 0), 2)
    assertEquals(homepageGame.lobbyPlayers, 0)

    val customGame = empty.updateActiveGame(None, Some(Source.Lobby), humanPlayers = 2, delta = 1)
    assertEquals(customGame.poolPlayers(room, waitingPlayers = 0), 0)
    assertEquals(customGame.lobbyPlayers, 2)

    val aiGame = customGame.updateActiveGame(None, Some(Source.Ai), humanPlayers = 1, delta = 1)
    assertEquals(aiGame.lobbyPlayers, 2)
    assertEquals(aiGame.aiPlayers, 1)

  test("friend and AI games occupy only their dedicated homepage controls"):
    val room = PoolConfigId("15+0-m90-30x3")
    val empty = HomepageGameCounts(Map.empty, friendGames = 0, aiGames = 0, lobbyPlayers = 0)

    val friend =
      empty.updateActiveGame(Some(room), Some(Source.Friend), humanPlayers = 2, delta = 1)
    assertEquals(friend.friendPlayers, 2)
    assertEquals(friend.poolPlayers(room, waitingPlayers = 0), 0)
    assertEquals(friend.lobbyPlayers, 0)

    val ai = friend.updateActiveGame(Some(room), Some(Source.Ai), humanPlayers = 1, delta = 1)
    assertEquals(ai.aiPlayers, 1)
    assertEquals(ai.poolPlayers(room, waitingPlayers = 0), 0)
    assertEquals(ai.lobbyPlayers, 0)

  test("an expired active game is removed from the same exclusive bucket"):
    val empty = HomepageGameCounts(Map.empty, friendGames = 0, aiGames = 0, lobbyPlayers = 0)
    val active = empty.updateActiveGame(None, Some(Source.Ai), humanPlayers = 1, delta = 1)
    val expired = active.updateActiveGame(None, Some(Source.Ai), humanPlayers = 1, delta = -1)

    assertEquals(active.aiPlayers, 1)
    assertEquals(expired.aiPlayers, 0)
    assertEquals(expired.lobbyPlayers, 0)
