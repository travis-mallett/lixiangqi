package views.lobby

import play.api.libs.json.Json

import lila.app.UiEnv.{ *, given }
import lila.app.mashup.Preload.Homepage

object home:

  def apply(homepage: Homepage)(using ctx: Context) =
    import homepage.*
    val donateLink =
      a(cls := "lobby__support-link", href := routes.Plan.index())(
        iconTag(patronIconChar),
        span(cls := "lobby__support-link__text")(
          strong(trans.patron.donate()),
          span(trans.patron.becomePatron())
        )
      )
    val swagLink =
      a(cls := "lobby__support-link", href := "/swag")(
        iconTag(Icon.Tshirt),
        span(cls := "lobby__support-link__text")(
          strong("Swag Store"),
          span(trans.site.playChessInStyle())
        )
      )
    Page("")
      .copy(fullTitle = s"$siteName • ${trans.site.freeOnlineChess.txt()}".some)
      .i18n(_.variant)
      .js(
        PageModule(
          "lobby",
          Json
            .obj(
              "data" -> data,
              "pools" -> lila.pool.PoolList.json(using ctx.translate),
              "homePools" -> lila.pool.PoolList.homepageJson(using ctx.translate),
              "showRatings" -> ctx.pref.showRatings
            )
            .add("hasUnreadLichessMessage", hasUnreadLichessMessage)
            .add("bots", Granter.opt(_.Beta))
            .add("playban", playban.map(lila.playban.TempBan.lobbyJson))
        )
      )
      .css("lobby")
      .graph(
        OpenGraph(
          image = staticAssetUrl("logo/lichess-tile-wide.png").some,
          title = "The best free, adless Xiangqi server",
          url = netBaseUrl.into(Url),
          description = trans.site.siteDescription.txt()
        )
      )
      .hrefLangs(lila.ui.LangPath("/")):
        main(
          cls := List(
            "lobby" -> true,
            "lobby-nope" -> (playban.isDefined || currentGame.isDefined || hasUnreadLichessMessage)
          )
        )(
          st.aside(cls := "lobby__rail", attr("aria-label") := "Homepage highlights")(
            div(cls := "lobby__site-counters"),
            donateLink,
            featured.map: game =>
              div(cls := "lobby__tv"):
                views.game.mini(Pov.naturalOrientation(game), tv = true)
            ,
            swagLink
          ),
          div(cls := "lobby__gameplay")(
            st.section(cls := "lobby__standard", attr("aria-label") := "Standard Xiangqi")(
              div(cls := "lobby__table"),
              currentGame
                .map(bits.currentGameInfo)
                .orElse(hasUnreadLichessMessage.option(bits.showUnreadLichessMessage))
                .orElse(playban.map(bits.playbanInfo)),
              div(cls := "lobby__feed"):
                views.feed.lobbyUpdates(lastUpdates)
            ),
            st.aside(cls := "lobby__variants", attr("aria-label") := "Xiangqi variants")(
              button(
                cls := "lobby__feature-card lobby__feature-card--variant",
                tpe := "button",
                attr("disabled") := true,
                aria.disabled := "true"
              )(
                span(cls := "lobby__coming-soon")(trans.site.comingSoon()),
                img(
                  cls := "lobby__feature-card__image",
                  src := assetUrl("images/homepage/xiangqi-dark-flip-mode.webp"),
                  alt := "",
                  aria.hidden := "true",
                  widthA := 384,
                  heightA := 384
                ),
                span(cls := "lobby__feature-card__body")(
                  strong(cls := "lobby__feature-card__title")(trans.site.darkFlipXiangqi()),
                  span(cls := "lobby__feature-card__subtitle")("揭棋"),
                  span(cls := "lobby__occupancy text", dataIcon := Icon.Group)("0")
                )
              ),
              bits.homepageLeaderboard(leaderboard, leaderboardFlags)
            )
          )
        )
