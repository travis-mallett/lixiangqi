package lila.web
package ui

import play.api.libs.json.Json

import lila.ui.*

import ScalatagsTemplate.*

final class LearnUi(helpers: Helpers):
  import helpers.*
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
