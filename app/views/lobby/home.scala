package views.lobby

import play.api.libs.json.Json

import lila.app.UiEnv.{ *, given }
import lila.app.mashup.Preload.Homepage
import lila.core.perf.UserWithPerfs

object home:

  def apply(homepage: Homepage)(using ctx: Context) =
    import homepage.*
    val isWudang = ctx.pref.uiTheme == lila.pref.UiThemes.wudang.key
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
        given Option[UserWithPerfs] = homepage.me
        main(
          cls := List(
            "lobby" -> true,
            "lobby-nope" -> (playban.isDefined || currentGame.isDefined || homepage.hasUnreadLichessMessage)
          )
        )(
          div(cls := "lobby__side")(
            ctx.blind.option(h2(trans.nvui.featuredEvents())),
            ctx.kid.no.option(views.streamer.bits.liveStreams(streams)),
            div(cls := "lobby__spotlights"):
              val eventTags = events.map(bits.spotlight)
              val relayTags = views.relay.ui.spotlight(relays)
              frag(
                eventTags,
                relayTags,
                ctx.noBot.option {
                  val nbManual = eventTags.size + relayTags.size
                  val tourBBBs = if nbManual >= 3 then 0 else 3 - nbManual
                  lila.tournament.Spotlight.select(tours, tourBBBs).map {
                    views.tournament.list.homepageSpotlight(_)
                  }
                }
              )
            ,
            classes.nonEmpty.option:
              div(cls := "lobby__classes"):
                classes.map: clas =>
                  a(href := routes.Clas.show(clas.id), dataIcon := Icon.Group)(clas.name)
            ,
            if ctx.isAuth then
              div(cls := "lobby__timeline")(
                ctx.blind.option(h2(trans.site.timeline())),
                views.timeline.entries(userTimeline),
                userTimeline.nonEmpty.option:
                  a(cls := "more", href := routes.Timeline.home)(trans.site.more(), " »")
              )
            else
              Option.unless(isWudang):
                div(cls := "about-side")(
                  ctx.blind.option(h2(trans.site.about())),
                  trans.site.xIsAFreeYLibreOpenSourceChessServer(
                    "Lixiangqi",
                    a(cls := "blue", href := routes.Plan.features)(trans.site.really.txt())
                  ),
                  " ",
                  a(href := "/about")(trans.site.aboutX("Lixiangqi"), "...")
                )
          ),
          currentGame
            .map(bits.currentGameInfo)
            .orElse:
              hasUnreadLichessMessage.option(bits.showUnreadLichessMessage)
            .orElse:
              playban.map(bits.playbanInfo)
            .getOrElse:
              if ctx.blind then blindLobby(blindGames) else bits.lobbyApp
          ,
          div(cls := "lobby__table")(
            div(cls := "lobby__start")(
              button(cls := "button button-metal lobby__start__button lobby__start__button--hook")(
                trans.site.createLobbyGame()
              ),
              button(cls := "button button-metal lobby__start__button lobby__start__button--friend")(
                trans.site.challengeAFriend()
              ),
              button(cls := "button button-metal lobby__start__button lobby__start__button--ai")(
                trans.site.playAgainstComputer()
              )
            )
          ),
          Option.unless(isWudang)(div(cls := "lobby__support")(donateLink, swagLink)),
          div(cls := "lobby__tv")(
            Option.unless(isWudang)(donateLink),
            featured.map(g => views.game.mini(Pov.naturalOrientation(g), tv = true))
          ),
          div(cls := "lobby__puzzle")(
            Option.unless(isWudang)(swagLink),
            puzzle.map(p => views.puzzle.bits.dailyLink(p)())
          ),
          views.ublog.ui.homeCarousel(ublogPosts),
          div(cls := "lobby__feed"):
            views.feed.lobbyUpdates(lastUpdates)
          ,
          ctx.noBot.option(bits.underboards(tours)),
          div(cls := "lobby__about")(
            ctx.blind.option(h2(trans.site.about())),
            a(href := "/about")(trans.site.aboutX("Lixiangqi")),
            a(href := "/faq")(trans.faq.faqAbbreviation()),
            a(href := "/contact")(trans.contact.contact()),
            a(href := "/app")(trans.site.mobileApp()),
            a(href := routes.Cms.tos)(trans.site.termsOfService()),
            a(href := "/privacy")(trans.site.privacy()),
            a(href := "/source")(trans.site.sourceCode()),
            a(href := "/ads")("Ads"),
            views.bits.connectLinks
          )
        )
