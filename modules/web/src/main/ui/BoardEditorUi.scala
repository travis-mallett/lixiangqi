package lila.web
package ui

import play.api.libs.json.*

import lila.common.Json.given
import lila.ui.*
import lila.xiangqi.Xiangqi

import ScalatagsTemplate.*

final class BoardEditorUi(helpers: Helpers):
  import helpers.{ *, given }

  def apply(fen: Option[String])(using Context) =
    Page(trans.site.boardEditor.txt())
      .js(
        PageModule(
          "editor",
          jsData(fen)
        )
      )
      .css("editor")
      .flag(_.zoom)
      .graph(
        title = "Xiangqi board editor",
        url = routeUrl(routes.Editor.index),
        description = "Create and validate Xiangqi positions on a 9 by 10 board."
      ):
        main(id := "board-editor")(
          div(cls := "board-editor")(
            div(cls := "spare"),
            div(cls := "main-board xiangqi9x10")(chessgroundBoard),
            div(cls := "spare")
          )
        )

  def jsData(fen: Option[String] = None)(using ctx: Context) =
    Json
      .obj(
        "baseUrl" -> routeUrl(routes.Editor.index),
        "startFen" -> Xiangqi.startFen,
        "animation" -> Json.obj("duration" -> ctx.pref.animationMillis)
      )
      .add("fen" -> fen)
