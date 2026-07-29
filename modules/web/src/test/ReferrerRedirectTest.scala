package lila.web

import lila.core.config.BaseUrl

class ReferrerRedirectTest extends munit.FunSuite:

  def r = new ReferrerRedirect(BaseUrl("https://lixiangqi.org"))
  def valid(ref: String) = r.valid(ref).map(_.value)

  test("be valid"):
    assertEquals(valid("/tournament"), Some("https://lixiangqi.org/tournament"))
    assertEquals(valid("/@/neio"), Some("https://lixiangqi.org/@/neio"))
    assertEquals(valid("/@/Neio"), Some("https://lixiangqi.org/@/Neio"))
    assertEquals(valid("/"), Some("https://lixiangqi.org/"))
    assertEquals(valid("https://lixiangqi.org/tournament"), Some("https://lixiangqi.org/tournament"))
    assertEquals(
      valid("https://lixiangqi.org/?a_a=b-b&C[]=#hash"),
      Some("https://lixiangqi.org/?a_a=b-b&C[]=#hash")
    )
    assertEquals(valid("/api"), Some("https://lixiangqi.org/api"))
    assertEquals(valid("/something/api/something"), Some("https://lixiangqi.org/something/api/something"))

  test("be invalid"):
    assertEquals(valid(""), None)
    assertEquals(valid("//foo.lixiangqi.org"), None)
    assertEquals(valid("ftp://lixiangqi.org/tournament"), None)
    assertEquals(valid("https://evil.com"), None)
    assertEquals(valid("https://evil.com/foo"), None)
    assertEquals(valid("//evil.com"), None)
    assertEquals(valid("//lixiangqi.org.evil.com"), None)
    assertEquals(valid("/\t/evil.com"), None)
    assertEquals(valid("/ /evil.com"), None)
    assertEquals(valid("http://lixiangqi.org/"), None) // downgrade to http
    assertEquals(valid("/login"), None)
    assertEquals(valid("/account/personal-data"), None)
    assertEquals(valid("/api/games/user/Cammy"), None)
    assertEquals(valid("/api/broadcast/abcdefgh"), None)
    assertEquals(valid("https://lixiangqi.org/api/broadcast/abcdefgh"), None)
    assertEquals(valid("https://lixiangqi.org/something.pgn"), None)
    assertEquals(valid("https://lixiangqi.org/swiss/abcdefgh.trf"), None)
    assertEquals(valid("https://lixiangqi.org/games/export/Cammy"), None)
