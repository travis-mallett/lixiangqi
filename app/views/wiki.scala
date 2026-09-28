package views

import play.api.libs.json.{ Json, JsObject }

import lila.app.UiEnv.{ *, given }

object wiki:
  def elbowHorse(article: String, examples: Vector[JsObject])(using ctx: EmbedContext) =
    val module = PageModule(
      "xiangqi.specialRules",
      Json.obj(
        "examples" -> examples,
        "animationDuration" -> ctx.pref.animationMillis,
        "diagrams" -> Json.arr(
          Json.obj(
            "id" -> "elbow-horse-map",
            "fen" -> "9/9/9/9/9/9/9/9/9/9 w - - 0 1",
            "shapes" -> (
              List("c9", "g9", "c2", "g2").map(square =>
                Json.obj("orig" -> square, "brush" -> "blue")
              ) ++ List("b9", "h9", "b2", "h2").map(square =>
                Json.obj(
                  "orig" -> square,
                  "customSvg" -> """<svg viewBox="0 0 100 100"><rect x="15" y="15" width="70" height="70" fill="#aa7724" fill-opacity=".18" stroke="#aa7724" stroke-width="5"/></svg>"""
                )
              )
            )
          )
        )
      )
    )
    val modules = esmPage(module.name)
    val ui = views.base.page.ui
    lila.ui.Snippet:
      frag(
        ui.doctype,
        tag("html")(lang := "en", cls := "light")(
          head(
            ui.charset,
            ui.viewport,
            ui.metaCsp(basicCsp.withNonce(ctx.nonce).withInlineIconFont),
            st.headTitle("Elbow horse • LiXiangQi Wiki"),
            meta(
              name := "description",
              content := "The elbow horse in xiangqi: terminology, history, cultural reception, and selected games."
            ),
            cssTag("xiangqi.wiki"),
            views.base.page.pieceSetImages
              .load(ctx.pref.pieceSet, lila.pref.PieceSets.assets(ctx.pref.pieceSet)),
            ui.sitePreload(List(_.site, _.timeago), modules),
            ui.lichessFontFaceCss
          ),
          st.body(
            cls := List(
              "is2d" -> true,
              "simple-board" -> ctx.pref.simpleBoard,
              "piece-letter" -> ctx.pref.pieceNotationIsLetter
            ),
            ui.dataSoundSet := ctx.pref.soundSet,
            ui.dataMusicSet := lila.pref.MusicSets.none.key,
            ui.dataAssetUrl,
            ui.dataAssetVersion := assetVersion.value,
            ui.dataUiTheme := lila.pref.UiThemes.light.key,
            ui.dataColorScheme := "light",
            ui.dataPieceSet := ctx.pref.pieceSet,
            ui.dataBoard := ctx.pref.boardTheme,
            ui.dataSocketDomains,
            ui.dataNonce := ctx.nonce,
            attr("data-board-animations") := ctx.pref.boardAnimations,
            style := views.base.page.boardStyle(zoomable = false)
          )(
            raw(article),
            ui.inlineJs(ctx.nonce),
            ui.modulesInit(modules, ctx.nonce.some),
            jsonScript(module.data)
          )
        )
      )
