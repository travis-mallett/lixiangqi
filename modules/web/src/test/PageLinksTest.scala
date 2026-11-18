package lila.web

class PageLinksTest extends munit.FunSuite:
  test("language URLs remain distinct from the negotiating default"):
    for language <- List("en", "zh", "vi", "ast") do
      assertEquals(PageLinks.localizedCanonical("/", s"/$language"), s"/$language")
      assertEquals(PageLinks.localizedCanonical("/learn", s"/$language/learn"), s"/$language/learn")
    assertEquals(PageLinks.localizedCanonical("/", "/"), "/")
    assertEquals(PageLinks.localizedCanonical("/learn", "/learn"), "/learn")
    assertEquals(PageLinks.localizedCanonical("/training", "/training/next"), "/training")

  test("language canonicals preserve meaningful filters and pagination"):
    val base = "/blog/community?filter=best&page=2"
    assertEquals(PageLinks.localizedCanonical(base, "/de/blog/community"), s"/de$base")
    assertEquals(PageLinks.localizedCanonical(base, "/blog/community"), base)
