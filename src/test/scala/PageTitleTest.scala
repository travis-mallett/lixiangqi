import munit.FunSuite

import lila.ui.Page

class PageTitleTest extends FunSuite:

  test("browser title adds the configured site suffix"):
    assertEquals(
      Page("player Mini Xiangqi").browserTitle("lixiangqi.org"),
      "player Mini Xiangqi • lixiangqi.org"
    )

  test("explicit full title takes precedence over generated browser title"):
    val page = Page("profile", fullTitle = Some("custom title"))
    assertEquals(page.browserTitle("lixiangqi.org"), "custom title")
