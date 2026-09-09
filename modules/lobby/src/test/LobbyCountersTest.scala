package lila.lobby

import play.api.libs.json.Json

class LobbyCountersTest extends munit.FunSuite:

  test("reads complete websocket snapshots"):
    val json = Json.parse("""{"members":12,"rounds":7,"poolCounts":{"lobby":3,"friend":2}}""")
    assertEquals(json.as[LobbyCounters], LobbyCounters(12, 7, Map("lobby" -> 3, "friend" -> 2)))

  test("rejects incomplete or malformed snapshots"):
    assert(Json.parse("""{"members":12,"rounds":7}""").validate[LobbyCounters].isError)
    assert(Json.parse("""{"members":"12","rounds":7,"poolCounts":{}}""").validate[LobbyCounters].isError)
