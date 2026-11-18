package lila.common

class SitemapTest extends munit.FunSuite:
  test("XML escapes URLs and uses only supplied modification dates"):
    val xml = Sitemap.render(
      List(
        Sitemap.Entry(
          "/blog/community?filter=best&page=2",
          alternates = List("en" -> "/en/blog/community?filter=best&page=2")
        )
      ),
      "https://example.org"
    )
    assert(xml.contains("filter=best&amp;page=2"))
    assert(!xml.contains("<lastmod>"))

  test("reject duplicate and foreign URLs"):
    intercept[IllegalArgumentException]:
      Sitemap.render(List(Sitemap.Entry("/"), Sitemap.Entry("/")), "https://example.org")
    intercept[IllegalArgumentException]:
      Sitemap.render(List(Sitemap.Entry("//elsewhere.example/")), "https://example.org")
