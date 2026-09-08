package views.round

import play.api.libs.json.Json

import lila.app.UiEnv.{ *, given }
import lila.common.Json.given
import lila.pool.PoolConfig

def matchmaking(pool: PoolConfig)(using ctx: Context) =
  val pageTitle =
    if pool.ranked then trans.site.playRatedXiangqi.txt() else trans.site.playCasualXiangqi.txt()
  ui.RoundPage(chess.variant.Standard, pageTitle)
    .js:
      PageModule(
        "round.matchmaking",
        Json.obj(
          "pool" -> pool,
          "userId" -> ctx.userId,
          "username" -> ctx.username
        )
      )
    .flag(_.zen)
    .flag(_.noRobots)
    .flag(_.playing):
      main(cls := "round round--matchmaking")(
        st.aside(cls := "round__side round__matchmaking-side")(
          a(cls := "round__matchmaking-back text", dataIcon := Icon.LessThan, href := routes.Lobby.home)(
            trans.site.backToHomepage()
          ),
          h1(pageTitle)
        ),
        div(cls := "round__app variant-standard round__app--matchmaking")(
          div(cls := "round__app__board main-board xiangqi9x10")(
            div(cls := "cg-wrap xiangqi9x10")
          )
        ),
        div(cls := "round__underboard"),
        div(cls := "round__underchat")
      )
