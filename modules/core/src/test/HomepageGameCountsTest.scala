package lila.core.pool

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

    val homepageGame = empty.updateActiveGame(Some(room), humanPlayers = 2, delta = 1)
    assertEquals(homepageGame.poolPlayers(room, waitingPlayers = 0), 2)
    assertEquals(homepageGame.lobbyPlayers, 0)

    val customGame = empty.updateActiveGame(None, humanPlayers = 2, delta = 1)
    assertEquals(customGame.poolPlayers(room, waitingPlayers = 0), 0)
    assertEquals(customGame.lobbyPlayers, 2)

    val aiGame = customGame.updateActiveGame(None, humanPlayers = 1, delta = 1)
    assertEquals(aiGame.lobbyPlayers, 3)
