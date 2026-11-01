package lila.puzzle

import java.net.URLDecoder
import java.nio.charset.StandardCharsets

import lila.core.userId.UserStr

class PlayerPuzzleSearchTest extends munit.FunSuite:
  test("valid player names are trimmed for lookup and display"):
    val search = PlayerPuzzleSearch.from(Some("  Alice_123  "))
    assertEquals(search.query, "Alice_123")
    assertEquals(search.userName, Some(UserStr("Alice_123")))

  test("invalid nonblank names remain available for not-found feedback"):
    val search = PlayerPuzzleSearch.from(Some("  invalid name  "))
    assertEquals(search.query, "invalid name")
    assertEquals(search.userName, None)

  test("whitespace-only names become an empty query"):
    val search = PlayerPuzzleSearch.from(Some("   "))
    assertEquals(search.query, "")
    assertEquals(search.userName, None)

  test("international names survive encoded pagination routes"):
    val search = PlayerPuzzleSearch.from(Some("  用户Player88  "))
    val username = search.userName.get.value
    val url = routes.Puzzle.ofPlayer(Some(username), 2).url
    val encodedName = url.split("[?&]").find(_.startsWith("name=")).get.stripPrefix("name=")
    assert(encodedName.forall(_ < 128))
    assertEquals(URLDecoder.decode(encodedName, StandardCharsets.UTF_8), "用户Player88")
    assert(url.contains("page=2"))
