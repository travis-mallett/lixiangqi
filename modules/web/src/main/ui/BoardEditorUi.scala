package lila.web
package ui

import play.api.libs.json.*

import lila.common.Json.given
import lila.ui.*
import lila.xiangqi.GameVariant

import ScalatagsTemplate.{ *, given }

final class BoardEditorUi(helpers: Helpers):
  import helpers.{ *, given }

  def apply(fen: Option[String], orientation: Option[String], variant: GameVariant)(using Context) =
    Page(trans.site.xiangqiEditorTitle.txt())
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
        title = trans.site.xiangqiEditorTitle.txt(),
        url = routeUrl(routes.Editor.index),
        description = trans.site.xiangqiEditorDescription.txt()
      )
      .append(
        ToolIntro(trans.site.xiangqiEditorTitle.txt(), trans.site.xiangqiEditorDescription.txt())(
          a(href := routes.UserAnalysis.index)(trans.site.analysis()),
          a(href := routes.Cms.variantHome)(trans.site.variants())
        )
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
