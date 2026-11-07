package lila.web
package ui

import play.api.libs.json.*

import lila.common.Json.given
import lila.ui.*
import lila.xiangqi.GameVariant

import ScalatagsTemplate.*

final class BoardEditorUi(helpers: Helpers):
  import helpers.{ *, given }

  def apply(fen: Option[String], orientation: Option[String], variant: GameVariant)(using Context) =
    Page(trans.site.boardEditor.txt())
      .js(
        PageModule(
          "editor",
          jsData(fen, orientation, variant)
        )
      )
      .css("editor")
      .i18nOpt(variant == GameVariant.ThreeKingdoms, _.threeKingdoms)
      .flag(_.zoom)
      .graph(
        title = "Xiangqi board editor",
        url = routeUrl(routes.Editor.index),
        description = "Create and validate positions for Xiangqi and its variants."
      ):
        main(id := "board-editor")(
          div(cls := "board-editor")(
            div(cls := "spare"),
            div(cls := "main-board xiangqi9x10")(chessgroundBoard),
            div(cls := "spare")
          )
        )

  def jsData(
      fen: Option[String] = None,
      orientation: Option[String] = None,
      variant: GameVariant = GameVariant.Xiangqi
  )(using ctx: Context) =
    Json
      .obj(
        "baseUrl" -> routeUrl(routes.Editor.index),
        "startFen" -> variant.startFen,
        "variant" -> variant.key,
        "options" -> Json.obj("orientation" -> orientation.getOrElse("red")),
        "animation" -> Json.obj("duration" -> ctx.pref.animationMillis)
      )
      .add("fen" -> fen)
