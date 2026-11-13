package views.lobby

import play.api.libs.json.Json

import lila.app.UiEnv.{ *, given }
import lila.app.mashup.Preload.Homepage

object home:

  def apply(homepage: Homepage)(using ctx: Context) =
    import homepage.*
    val variantTvName = lila.core.i18n.I18nKey(variantTv.nameKey).txt()
    val donateLink =
      a(cls := "lobby__support-link", href := routes.Plan.index())(
        iconTag(patronIconChar),
        span(cls := "lobby__support-link__text")(
          strong("Donate"),
          span("Become a patron")
        )
      )
    def dailyPuzzleCard(daily: lila.puzzle.DailyPuzzle.WithHtml, placement: String) =
      st.section(
        cls := s"lobby__daily-puzzle lobby__daily-puzzle--$placement lobby__rail-card",
        attr("aria-labelledby") := s"daily-puzzle-title-$placement"
      )(
        h2(id := s"daily-puzzle-title-$placement", cls := "lobby__rail-title")(
          iconTag(Icon.Target),
          trans.puzzle.puzzleOfTheDay()
        ),
        a(
          cls := "lobby__daily-puzzle__link",
          href := routes.Puzzle.daily,
          title := trans.puzzle.clickToSolve.txt()
        )(
          daily.html,
          span(cls := "lobby__daily-puzzle__turn")(
            daily.puzzle.color.fold(trans.site.whitePlays(), trans.site.blackPlays()),
            " ›"
          )
        )
      )
    def variantCard(icon: String, chinese: String, english: String) =
      (if Set("jieqi", "mini-xiangqi", "manchu", "threeKingdoms").contains(icon) then
         a(href := s"/?variant=${if icon == "mini-xiangqi" then "minixiangqi" else icon}")
       else st.article(attr("aria-disabled") := "true")) (cls := "lobby__variant-card")(
        if Set("jieqi", "mini-xiangqi", "manchu", "threeKingdoms").contains(icon) then
          span(cls := "lobby__variant-ribbon lobby__variant-ribbon--new")(trans.site.newFeature())
        else span(cls := "lobby__variant-ribbon")(trans.site.comingSoon()),
        img(
          cls := s"lobby__variant-icon lobby__variant-icon--$icon",
          src := assetUrl(
            s"images/homepage/variants/${if icon == "threeKingdoms" then "three-player" else icon}.png"
          ),
          alt := "",
          aria.hidden := "true",
          widthA := 224,
          heightA := 224,
          attr("loading") := "lazy",
          attr("decoding") := "async"
        ),
        span(cls := "lobby__variant-card__label lobby__label-en")(s"$english ($chinese)")
      )
    Page("")
      .copy(fullTitle = s"$siteName • ${trans.site.freeOnlineChess.txt()}".some)
      .i18n(_.variant)
      .i18n(_.threeKingdoms)
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
            st.section(
              cls := "lobby__tv lobby__rail-card",
              attr("aria-labelledby") := "lobby-tv-title",
              attr("data-mini-game-animation") := ctx.pref.animationMillis
            )(
              h2(id := "lobby-tv-title", cls := "lobby__rail-title")(
                iconTag(Icon.AnalogTv),
                a(href := routes.Tv.index)("LiXiangQi TV")
              ),
              div(cls := "lobby__tv__game")(
                featured.fold[Frag](p(cls := "box__pad", role := "status")(trans.site.noGameFound())): game =>
                  views.game.mini(Pov.naturalOrientation(game), tv = true, replayFinished = true)
              ),
              h3(cls := "lobby__rail-title")(
                iconTag(lila.ui.VariantIcon(variantTv)),
                a(href := routes.Tv.onChannel(variantTv.key))(variantTvName)
              ),
              iframe(
                cls := "lobby__tv__variant",
                // Keep browser-restored frame history scoped to the randomly selected channel.
                name := s"lobby-tv-${variantTv.key}",
                attr("data-theme-embed") := "",
                attr("data-content-sized") := "",
                src := s"/tv/${variantTv.key}/frame?uiTheme=${ctx.pref.uiTheme}&boardTheme=${ctx.pref.boardTheme}&pieceSet=${ctx.pref.pieceSet}",
                title := variantTvName,
                attr("loading") := "lazy"
              )
            ),
            puzzle.map(dailyPuzzleCard(_, "left")),
            donateLink
          ),
          div(cls := "lobby__center-rail")(
            st.section(cls := "lobby__standard", attr("aria-label") := "Standard Xiangqi")(
              views.lobby.preload.table,
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
                variantCard("mini-xiangqi", "迷你象棋", trans.site.miniXiangqi.txt()),
                variantCard("threeKingdoms", "三国棋", trans.site.threeKingdoms.txt()),
                variantCard("manchu", "满洲棋", trans.site.manchu.txt()),
                variantCard("other", "其他变体", "Other Variants")
              )
            ),
            blogPosts.nonEmpty.option(views.ublog.ui.homeCarousel(blogPosts))
          ),
          st.aside(cls := "lobby__right-rail", attr("aria-label") := "Community highlights")(
            bits.homepageLeaderboard(leaderboard, leaderboardFlags, personal),
            st.section(cls := "lobby__feed", attr("aria-labelledby") := "lobby-updates-title")(
              h2(id := "lobby-updates-title", cls := "lobby__feed__title")(
                a(href := routes.Feed.index())(
                  iconTag(Icon.RssFeed),
                  "Updates"
                ),
                a(cls := "more", href := routes.Feed.index())(trans.site.more(), " ›")
              ),
              views.feed.lobbyUpdates(lastUpdates)
            ),
            puzzle.map(dailyPuzzleCard(_, "right"))
          ),
          st.footer(cls := "lobby__footer", attr("aria-label") := "LiXiangQi links")(
            a(href := "/about")(trans.site.aboutX("LiXiangQi")),
            a(href := routes.Main.faq)(trans.faq.faqAbbreviation()),
            a(href := routes.Cms.tos)(trans.site.termsOfService()),
            a(href := "/privacy")(trans.site.privacy()),
            a(href := routes.Cms.source)(trans.site.sourceCode()),
            a(href := "/ads")(trans.site.blockAds()),
            a(href := "https://discord.gg/rUFqhX7SzJ", target := "_blank")("Discord")
          )
        )
