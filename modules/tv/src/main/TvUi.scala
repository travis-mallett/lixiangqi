package lila.tv
package ui

import play.api.libs.json.{ Json, JsObject }

import lila.ui.*
import lila.ui.ScalatagsTemplate.{ *, given }
import lila.game.ui.GameUi
import lila.core.i18n.Translate
import lila.core.rank.RankCode.value
import lila.common.ClientName

final class TvUi(helpers: lila.ui.Helpers)(
    gameUi: GameUi,
    tournamentLink: TourId => (Translate, ClientName) ?=> Tag
):
  import helpers.{ *, given }

  extension (channel: Tv.Channel)
    private def translate(using Context): String =
      channel match
        case Tv.Channel.Xiangqi => trans.site.xiangqi.txt()
        case Tv.Channel.Jieqi => trans.site.jieqi.txt()
        case Tv.Channel.MiniXiangqi => trans.site.miniXiangqi.txt()
        case Tv.Channel.ThreeKingdoms => trans.site.threeKingdoms.txt()
        case Tv.Channel.Computer => trans.site.computer.txt()
        case _ => channel.name

  def index(
      channel: Tv.Channel,
      champions: Tv.Champions,
      pov: Pov,
      data: JsObject,
      cross: Option[lila.game.Crosstable.WithMatchup],
      history: List[Pov]
  )(page: Page)(roundApp: Tag)(using Context, ClientName) =
    page
      .js(PageModule("round", Json.obj("data" -> data)))
      .css("bits.tv.single")
      .graph(
        title = s"Watch the best ${channel.name.toLowerCase} games of lixiangqi.org",
        description =
          s"Sit back, relax, and watch the best ${channel.name.toLowerCase} Lixiangqi players compete on Lixiangqi TV",
        url = routeUrl(routes.Tv.onChannel(channel.key))
      )
      .flag(_.zen)
      .hrefLangs(lila.ui.LangPath(routes.Tv.index)):
        main(cls := "round tv-single")(
          st.aside(cls := "round__side")(
            side.meta(pov),
            side.channels(channel, champions, "/tv"),
            a(cls := "button button-empty", href := routes.Tv.gamesChannel(channel.key))(
              trans.site.currentGames()
            )
          ),
          roundApp,
          div(cls := "round__underboard")(
            gameUi.crosstable.option(cross, pov.game),
            div(cls := "tv-history")(
              h2(trans.site.previouslyOnLichessTV()),
              div(cls := "now-playing"):
                frag(
                  history.isEmpty.option(p(cls := "box__pad", role := "status")(trans.site.noGameFound())),
                  history.map { gameUi.mini(_) }
                )
            )
          )
        )

  def games(
      channel: Tv.Channel,
      povs: List[Pov],
      champions: Tv.Champions,
      baseUrl: String = "/games",
      recent: List[Pov] = Nil
  )(using
      Context
  ) =
    Page(s"${channel.translate} • ${trans.site.currentGames.txt()}")
      .css("bits.tv.games")
      .js(Esm("bits.tvGames")):
        main(
          cls := "page-menu tv-games",
          dataRel := routeUrl(routes.Tv.gameChannelReplacement(channel.key, GameId("gameId"), Nil))
        )(
          st.aside(cls := "page-menu__menu"):
            side.channels(channel, champions, baseUrl)
          ,
          div(cls := "page-menu__content")(
            h1(channel.translate),
            a(cls := "button button-empty", href := routes.Tv.onChannel(channel.key))(trans.site.watch()),
            h2(trans.site.currentGames()),
            div(cls := "tv-current now-playing")(
              povs.isEmpty.option(p(cls := "box__pad", role := "status")(trans.site.noGameFound())),
              povs.map(gameUi.mini(_))
            ),
            h2(trans.site.previouslyOnLichessTV()),
            div(cls := "tv-recent now-playing")(
              recent.isEmpty.option(p(cls := "box__pad", role := "status")(trans.site.noGameFound())),
              recent.map(gameUi.mini(_))
            )
          )
        )

  object side:

    private val separator = " • "

    def meta(pov: Pov)(using Context, ClientName): Frag =
      import pov.*
      div(cls := "game__meta")(
        st.section(
          div(cls := "game__meta__infos", dataIcon := gameUi.gameIcon(game))(
            div(cls := "header")(
              div(cls := "setup")(
                gameUi.widgets.showClock(game),
                separator,
                rankedName(game.ranked),
                separator,
                nativeVariantLink(game, game.perfKey)
              )
            )
          ),
          div(cls := "game__meta__players"):
            game.players.mapList: p =>
              div(cls := s"player color-icon is ${p.color.name} text"):
                playerLink(p, withOnline = false, withDiff = true, withBerserk = true)
        ),
        game.tournamentId.map: tourId =>
          st.section(cls := "game__tournament-link"):
            tournamentLink(tourId)
      )

    def channels(channel: Tv.Channel, champions: Tv.Champions, baseUrl: String)(using Context): Frag =
      lila.ui.bits.subnav:
        Tv.Channel.list.map: c =>
          a(
            href := s"$baseUrl/${c.key}",
            cls := List(
              "tv-channel" -> true,
              c.key -> true,
              "active" -> (c == channel)
            )
          ):
            span(dataIcon := c.icon):
              span(
                strong(c.translate),
                span(cls := "champion")(
                  champions
                    .get(c)
                    .fold[Frag](raw(" - ")): p =>
                      frag(
                        p.user.title.fold[Frag](p.user.name)(t => frag(t, nbsp, p.user.name)),
                        " ",
                        span(cls := "rank")(p.rank.fold("Unranked")(_.value))
                      )
                )
              )

    def sides(
        pov: Pov,
        cross: Option[lila.game.Crosstable.WithMatchup]
    )(using Context) =
      div(cls := "sides"):
        cross.map:
          gameUi.crosstable(_, pov.gameId.some)
