package lila.puzzle

import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

import lila.core.userId.{ UserId, UserStr }

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

  for
    query <- List("qa-no-such-player-91736", "qa-nobody-82751")
    current <- List(Some("signed-in-user"), None)
  do
    test(s"unresolved explicit search $query never substitutes current user $current"):
      val search = PlayerPuzzleSearch.from(Some(query))
      var lookedUp = List.empty[UserId]
      search
        .resolve(current) { id =>
          lookedUp = lookedUp :+ id
          Future.successful(None)
        }
        .map: result =>
          assertEquals(result, None)
          assertEquals(search.query, query)
          assertEquals(lookedUp, List(UserId(query)))

  for current <- List(Some("signed-in-user"), None) do
    test(s"resolved explicit search selects requested player with current user $current"):
      val search = PlayerPuzzleSearch.from(Some("  ChineseChessOutLoud  "))
      search
        .resolve(current) { id =>
          assertEquals(id, UserId("chinesechessoutloud"))
          Future.successful(Some("requested-player"))
        }
        .map: result =>
          assertEquals(result, Some("requested-player"))
          assertEquals(search.query, "ChineseChessOutLoud")

    test(s"invalid nonblank search does not substitute current user $current"):
      val search = PlayerPuzzleSearch.from(Some("  invalid name  "))
      search
        .resolve(current) { _ => fail("Invalid names must not query the repository") }
        .map: result =>
          assertEquals(result, None)
          assertEquals(search.query, "invalid name")

    for raw <- List(None, Some(""), Some("   ")) do
      test(s"blank search $raw uses current user $current without a repository lookup"):
        val search = PlayerPuzzleSearch.from(raw)
        search
          .resolve(current) { _ => fail("Blank names must not query the repository") }
          .map: result =>
            assertEquals(result, current)
            assertEquals(search.query, "")
