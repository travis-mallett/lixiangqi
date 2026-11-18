package lila.web

class PublicSitemapTest extends munit.FunSuite:
  test("only completed landing pages have static sitemap entries"):
    val paths = PublicSitemap.core.map(_.path)
    assertEquals(paths.distinct, paths)
    List("/analysis", "/editor", "/privacy", "/games/database", "/learn/special-rules", "/zh/training/themes")
      .foreach(path => assert(paths.contains(path)))
    List("/learn", "/login", "/signup", "/streak", "/storm", "/racer", "/tournament", "/zh/variant").foreach(
      path => assert(!paths.contains(path))
    )
    assert(PublicSitemap.core.forall(_.modified.isEmpty))

  test("localized sitemap entries have reciprocal canonical alternatives"):
    val entries = PublicSitemap.localized("/training/anglerHorse")
    assertEquals(
      entries.map(_.path),
      List(
        "/training/anglerHorse",
        "/en/training/anglerHorse",
        "/zh/training/anglerHorse",
        "/vi/training/anglerHorse"
      )
    )
    entries.foreach: entry =>
      assertEquals(entry.alternates.map(_._2), entries.map(_.path))
