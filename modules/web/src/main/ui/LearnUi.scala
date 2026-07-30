package lila.web
package ui

import play.api.libs.json.Json

import lila.ui.*

import ScalatagsTemplate.{ *, given }

final class LearnUi(helpers: Helpers):
  import helpers.*
  private val ancientManuals = List(
    ("zichudonglaiwudishou", "自出洞来无敌手", "The Invincible Xiangqi Manual"),
    ("yicheng", "奕乘", "Yicheng"),
    ("wushimeihuapu", "吴氏梅花谱", "Wu's Plum Flower Manual"),
    ("wushuangpinmeihuapu", "无双品梅花谱", "Unparalleled Plum Flower Manual"),
    ("shilinguangji", "事林广记", "Encyclopedia of Everything"),
    ("shanqingtang", "善庆堂重订梅花变", "Shan Qing Tang Revised Plum Flower Variations"),
    ("meihuaquan", "梅花泉", "Plum Flower Springs Manual"),
    ("meihuapu", "梅花谱", "Plum Flower Manual"),
    ("meihuabianfa", "梅花变法谱", "Plum Flower Variations Manual"),
    ("juzhongmi", "桔中秘", "Secret in the Tangerine"),
    ("jinpengshibabian", "金鹏十八变", "The 18 Stances of the Golden Roc"),
    ("fanmeihuapu", "反梅花谱", "Anti-Plum Flower Manual"),
    ("chongbentang", "崇本堂梅花谱", "Chong Ben Tang Plum Flower Manual")
  )

  def apply(data: Option[play.api.libs.json.JsValue])(using ctx: Context) =
    Page("Fundamentals of Xiangqi - learn by playing")
      .js:
        PageModule(
          "learn",
          Json.obj(
            "data" -> data,
            "pref" -> Json.obj(
              "coords" -> ctx.pref.coords,
              "destination" -> ctx.pref.destination
            )
          )
        )
      .css("learn")
      .i18n(_.learn)
      .graph(
        title = "Learn Xiangqi by playing",
        description =
          "Learn the board, pieces, rules, notation, tactics, and classical checkmating patterns of Xiangqi.",
        url = routeUrl(routes.Learn.index)
      )
      .hrefLangs(lila.ui.LangPath(routes.Learn.index))
      .flag(_.zoom):
        main(id := "learn-app")

  def ancientManualsPage(explorerEndpoint: String)(using ctx: Context) =
    val chinese = ctx.lang.language == "zh"
    val pageTitle = if chinese then "古谱" else "Ancient Manuals"
    Page(pageTitle)
      .js:
        PageModule(
          "xiangqi.manuals",
          Json.obj(
            "explorerEndpoint" -> explorerEndpoint,
            "language" -> ctx.lang.code
          )
        )
      .css("learn")
      .graph(
        title = "Ancient Xiangqi Manuals",
        description = "Study classical Xiangqi manuals by chapter and annotated game.",
        url = routeUrl(routes.Learn.ancientManuals)
      )
      .flag(_.zoom):
        main(cls := "ancient-manuals box")(
          header(cls := "ancient-manuals__hero")(
            p(cls := "ancient-manuals__eyebrow")(
              if chinese then "中国象棋古典文库" else "The classical Xiangqi library"
            ),
            h1(pageTitle),
            p(cls := "ancient-manuals__introduction")(
              if chinese then
                "古谱保存了历代棋手学习象棋所依循的战略思想、经典阵法与评注对局。它们的分析早于现代引擎和当代开局理论，却仍是理解象棋战术语言、古典原则与历史传承的重要途径。"
              else
                "Ancient manuals preserve the strategic ideas, named patterns, and annotated examples through which generations learned Xiangqi. Their analysis predates modern engines and current opening theory, but studying them remains invaluable for understanding the game's tactical language, classical principles, and history."
            ),
            p(
              id := "ancient-manuals-status",
              cls := "ancient-manuals__status",
              role := "status",
              attr("aria-live") := "polite",
              if chinese then "正在加载已导入的章节和棋局…" else "Loading imported chapters and games…"
            )
          ),
          st.section(
            cls := "ancient-manuals__library",
            attr("aria-labelledby") := "ancient-manuals-library-title"
          )(
            div(cls := "ancient-manuals__section-heading")(
              div(
                h2(id := "ancient-manuals-library-title")(
                  if chinese then "典籍目录" else "The collection"
                ),
                p(
                  if chinese then "选择一部古谱，浏览其章节与棋局。"
                  else "Choose a manual to explore its chapters and games."
                )
              )
            ),
            div(
              id := "ancient-manuals-list",
              cls := "ancient-manuals__grid",
              attr("aria-label") := (if chinese then "古谱目录" else "Ancient manuals")
            )(
              ancientManuals.map: (slug, nativeTitle, englishTitle) =>
                button(
                  cls := "ancient-manual-card",
                  tpe := "button",
                  attr("data-manual-slug") := slug,
                  attr("aria-expanded") := "false"
                )(
                  span(cls := "ancient-manual-card__cover")(
                    img(
                      src := staticAssetUrl("images/learn/ancient-manual-book.png"),
                      alt := "",
                      attr("aria-hidden") := "true"
                    ),
                    span(
                      cls := List(
                        "ancient-manual-card__inscription" -> true,
                        "long" -> (nativeTitle.length > 7)
                      ),
                      attr("aria-hidden") := "true",
                      lang := "zh"
                    )(
                      nativeTitle
                    )
                  ),
                  span(cls := "ancient-manual-card__copy")(
                    strong(cls := "ancient-manual-card__title")(
                      if chinese then nativeTitle else englishTitle
                    ),
                    span(cls := "ancient-manual-card__meta")(
                      if chinese then "正在加载…" else "Loading…"
                    )
                  )
                )
            )
          ),
          st.section(
            id := "ancient-manual-detail",
            cls := "ancient-manual-detail",
            attr("aria-live") := "polite",
            attr("hidden") := true
          )
        )
