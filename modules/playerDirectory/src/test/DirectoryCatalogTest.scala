package lila.playerDirectory

import play.api.libs.json.Json

class DirectoryCatalogTest extends munit.FunSuite:
  private def profile = DirectoryCatalog.read(
    Json.obj(
      "id" -> "wxf:IGM0012",
      "name" -> "许银川",
      "displayName" -> "Xu Yinchuan (许银川)",
      "aliases" -> List("许银川"),
      "title" -> "IGM",
      "titles" -> Json.arr(
        Json.obj(
          "issuer" -> "WXF",
          "code" -> "IGM",
          "status" -> "recorded",
          "source" -> Json.obj(
            "provider" -> "wxf",
            "url" -> "https://www.wxf-xiangqi.org/roster.pdf",
            "publishedAt" -> "2022-12-09"
          )
        )
      ),
      "provenance" -> Json.obj(
        "provider" -> "wxf",
        "url" -> "https://www.wxf-xiangqi.org/roster.pdf",
        "publishedAt" -> "2022-12-09"
      ),
      "photo" -> Json.obj(
        "url" -> "https://upload.wikimedia.org/portrait.png",
        "credit" -> "Author",
        "sourceUrl" -> "https://commons.wikimedia.org/wiki/File:Portrait",
        "license" -> "CC BY 3.0",
        "licenseUrl" -> "https://creativecommons.org/licenses/by/3.0/"
      ),
      "biography" -> Json.obj("en" -> "A sourced biography.", "zh-CN" -> "人物简介。"),
      "biographySources" -> List("https://example.org/biography"),
      "stats" -> Json.obj("games" -> 10, "wins" -> 4, "draws" -> 3, "losses" -> 3)
    )
  )

  test("catalog response retains stable identity, multilingual biography and image attribution"):
    val p = profile
    assertEquals(p.id.value, "wxf:IGM0012")
    assertEquals(p.name.value, "许银川")
    assertEquals(p.displayName.value, "Xu Yinchuan (许银川)")
    assertEquals(p.biography("zh-CN"), "人物简介。")
    assertEquals(p.photo.flatMap(_.licenseUrl), Some("https://creativecommons.org/licenses/by/3.0/"))
    assertEquals(p.stats.games, 10)
    assertEquals(p.standard, None)
    assertEquals(p.stats.team, None)
    assertEquals(p.titles.map(t => (t.issuer, t.code, t.status)), List(("WXF", "IGM", "recorded")))
    assertEquals(p.titles.head.statusSource, None)

  test("editor cannot leave any biography language without sources"):
    val form = DirectoryPlayer.form.edit(profile, "en")
    def bind(values: Map[String, String]) = form.bind(values + ("photo.credit" -> "Author"))
    assert(bind(Map("biography" -> "Edited", "sources" -> "javascript:bad")).hasErrors)
    assert(bind(Map("biography" -> "", "sources" -> "")).hasErrors)
    assert(!bind(Map("biography" -> "Edited", "sources" -> "https://example.org/source")).hasErrors)
    assert(form.bind(Map("biography" -> "Edited", "sources" -> "https://example.org/source")).hasErrors)
