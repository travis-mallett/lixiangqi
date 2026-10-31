package views.round

import play.api.libs.json.{ Json, JsObject }
import lila.app.UiEnv.{ *, given }

/** Three-seat games use the round page; only the game protocol differs. */
def threeKingdoms(mode: String, data: JsObject = Json.obj())(using Context) =
  ui.RoundPage(chess.variant.Standard, trans.site.threeKingdoms.txt())
    .i18n(_.threeKingdoms)
    .js(PageModule("round", threeKingdomsOptions(mode, data)))
    .flag(_.zen)
    .flag(_.noRobots)
    .body(threeKingdomsContent)

def threeKingdomsBootstrap(id: GameId, data: JsObject)(using Context) =
  Json.obj(
    "html" -> threeKingdomsContent.render,
    "url" -> s"/three-kingdoms/game/${id.value}",
    "title" -> s"${trans.site.threeKingdoms.txt()} • $siteName",
    "options" -> threeKingdomsOptions("game", data)
  )

private def threeKingdomsOptions(mode: String, data: JsObject)(using ctx: Context) =
  data ++ Json.obj(
    "mode" -> mode,
    "me" -> ctx.userId.map(_.value),
    "preferences" -> Json.obj(
      "animationDuration" -> ctx.pref.animationMillis,
      "moveEvent" -> ctx.pref.moveEvent,
      "highlight" -> ctx.pref.highlight
    )
  )

private def threeKingdomsContent(using Context) =
  main(cls := "round")(
    st.aside(cls := "round__side")(
      div(cls := "game__meta")(
        a(href := routes.Lobby.home)(trans.site.backToHomepage()),
        h1(trans.site.threeKingdoms())
      )
    ),
    div(cls := "round__app variant-threeKingdoms")(
      scalatags.Text.tags2.noscript(trans.threeKingdoms.javascriptRequired())
    ),
    div(cls := "round__underboard"),
    div(cls := "round__underchat")
  )
