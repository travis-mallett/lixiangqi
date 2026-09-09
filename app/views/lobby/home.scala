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
          strong("Donate"),
          span("Become a patron")
        )
      )
    val swagLink =
      a(cls := "lobby__support-link", href := "/swag")(
        iconTag(Icon.Tshirt),
        span(cls := "lobby__support-link__text")(
          strong("Swag Store"),
          span("Play Xiangqi in style")
        )
      )
    def variantCard(icon: String, chinese: String, english: String) =
      st.article(cls := "lobby__variant-card", attr("aria-disabled") := "true")(
        span(cls := "lobby__coming-soon")(trans.site.comingSoon()),
        img(
          cls := "lobby__variant-icon",
          src := assetUrl(s"images/homepage/variants/$icon.png"),
          alt := "",
          aria.hidden := "true",
          widthA := 224,
          heightA := 224,
          attr("loading") := "lazy",
          attr("decoding") := "async"
        ),
        span(cls := "lobby__variant-card__label lobby__label-en")(s"$english ($chinese)")
      )
    val meHref = ctx.me.fold(routes.Auth.login.url)(me => routes.User.show(me.username).url)
    Page("")
      .copy(fullTitle = s"$siteName • ${trans.site.freeOnlineChess.txt()}".some)
      .i18n(_.variant)
      .js(
        PageModule(
          "lobby",
          Json
            .obj(
              "data" -> data,
              "pools" -> lila.pool.PoolList.json,
              "homePools" -> lila.pool.PoolList.homepageJson
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
          st.aside(cls := "lobby__left-rail", attr("aria-label") := "Site activity and support")(
            st.section(cls := "lobby__site-stats lobby__rail-card", attr("aria-label") := "Site statistics")(
              div(cls := "lobby__site-counters")
            ),
            featured.map: game =>
              st.section(
                cls := "lobby__tv lobby__rail-card",
                attr("aria-labelledby") := "lobby-tv-title",
                attr("data-mini-game-animation") := ctx.pref.animationMillis
              )(
                h2(id := "lobby-tv-title", cls := "lobby__rail-title")(
                  iconTag(Icon.AnalogTv),
                  "Lixiangqi TV"
                ),
                views.game.mini(Pov.naturalOrientation(game), tv = true, replayFinished = true)
              ),
            donateLink,
            swagLink
          ),
          div(cls := "lobby__center-rail")(
            st.section(cls := "lobby__standard", attr("aria-label") := "Standard Xiangqi")(
              div(cls := "lobby__table"),
              currentGame
                .map(bits.currentGameInfo)
                .orElse(hasUnreadLichessMessage.option(bits.showUnreadLichessMessage))
                .orElse(playban.map(bits.playbanInfo))
            ),
            st.section(cls := "lobby__variants", attr("aria-labelledby") := "lobby-variants-title")(
              h2(id := "lobby-variants-title", cls := "lobby__section-title")(
                span(cls := "lobby__svg-icon lobby__svg-icon--variants", aria.hidden := true),
                span(cls := "lobby__label-en lobby__label-en--primary")("Variants")
              ),
              div(cls := "lobby__variant-grid")(
                variantCard("jieqi", "揭棋", "Jieqi / Reveal Chess"),
                variantCard("banqi", "暗棋", "Banqi / Dark Chess"),
                variantCard("mini-xiangqi", "迷你象棋", "Mini Xiangqi"),
                variantCard("three-player", "三人象棋", "Three-Player Xiangqi"),
                variantCard("manchu", "满洲棋", "Manchu Chess"),
                variantCard("other", "其他变体", "Other Variants")
              )
            )
          ),
          st.aside(cls := "lobby__right-rail", attr("aria-label") := "Community highlights")(
            bits.homepageLeaderboard(leaderboard, leaderboardFlags, personal),
            st.section(cls := "lobby__feed", attr("aria-labelledby") := "lobby-updates-title")(
              h2(id := "lobby-updates-title", cls := "lobby__feed__title")(
                iconTag(Icon.RssFeed),
                "Updates"
              ),
              views.feed.lobbyUpdates(lastUpdates)
            ),
            puzzle.map: daily =>
              st.section(
                cls := "lobby__daily-puzzle lobby__rail-card",
                attr("aria-labelledby") := "daily-puzzle-title"
              )(
                h2(id := "daily-puzzle-title", cls := "lobby__rail-title")(
                  iconTag(Icon.Target),
                  "Puzzle of the day"
                ),
                a(
                  cls := "lobby__daily-puzzle__link",
                  href := routes.Puzzle.daily,
                  title := trans.puzzle.clickToSolve.txt()
                )(
                  daily.html,
                  span(cls := "lobby__daily-puzzle__turn")(
                    daily.puzzle.color.fold("Red to play", "Black to play"),
                    " ›"
                  )
                )
              )
          ),
          st.nav(cls := "lobby__mobile-nav", attr("aria-label") := "Primary")(
            a(
              cls := "lobby__mobile-nav__item active",
              href := routes.Lobby.home,
              attr("aria-current") := "page"
            )(
              span(cls := "lobby__svg-icon lobby__svg-icon--home", aria.hidden := true),
              span(cls := "lobby__label-en")("Home")
            ),
            a(cls := "lobby__mobile-nav__item", href := routes.Learn.index)(
              span(cls := "lobby__svg-icon lobby__svg-icon--learn", aria.hidden := true),
              span(cls := "lobby__label-en")("Learn")
            ),
            a(cls := "lobby__mobile-nav__item", href := routes.User.list)(
              span(cls := "lobby__svg-icon lobby__svg-icon--community", aria.hidden := true),
              span(cls := "lobby__label-en")("Community")
            ),
            a(cls := "lobby__mobile-nav__item", href := meHref)(
              span(cls := "lobby__svg-icon lobby__svg-icon--user", aria.hidden := true),
              span(cls := "lobby__label-en")("Me")
            )
          )
        )
