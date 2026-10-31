package lila.user
package ui

import lila.core.perf.UserWithPerfs
import lila.core.rank.RankCode.*
import lila.core.rank.RankTrackId
import lila.core.rank.RankScore.*
import lila.core.user.LightRank
import lila.rating.UserPerfsExt.*
import lila.ui.*

import ScalatagsTemplate.{ *, given }

final class UserList(helpers: Helpers, bits: UserBits):
  import helpers.{ *, given }

  def page(
      online: List[UserWithPerfs],
      leaderboards: List[(RankTrackId, List[LightRank], Option[XiangqiPersonalRank])]
  )(using ctx: Context) =
    Page(trans.site.leaderboard.txt())
      .css("user.list")
      .flag(_.fullScreen)
      .graph(
        title = trans.site.leaderboard.txt(),
        url = routeUrl(routes.User.list),
        description = "The native Xiangqi rank leaderboard, from 学1-1 through 专3-3"
      ):
        main(cls := "page-menu")(
          bits.communityMenu("leaderboard"),
          div(cls := "community page-menu__content box box-pad")(
            st.section(cls := "community__online")(
              h2(trans.site.onlinePlayers()),
              ol(cls := "user-top"):
                online.map: u =>
                  li(
                    userLink(u),
                    u.perfs.xiangqiRankCode.map(code => span(cls := "rank")(code.value))
                  )
            ),
            div(cls := "community__leaders")(
              h2(trans.site.leaderboard()),
              div(cls := "leaderboards")(
                leaderboards.map((track, entries, personal) => leaderboard(track, entries, personal))
              )
            )
          )
        )

  private def leaderboard(
      track: RankTrackId,
      entries: List[LightRank],
      personal: Option[XiangqiPersonalRank]
  )(using ctx: Context) =
    val ranked = personal.collect { case XiangqiPersonalRank.Ranked(place, entry) => place -> entry }
    val extra = ranked.filterNot((_, entry) => entries.exists(_.user.id == entry.user.id))
    def row(entry: LightRank, place: Int) =
      li(st.value := place, cls := ranked.exists(_._2.user.id == entry.user.id).option("is-me"))(
        lightUserLink(entry.user),
        span(cls := "rank")(entry.rank.value),
        span(cls := "rating")(entry.score.value)
      )
    st.section(cls := "leaderboard", id := track.value)(
      h3(
        span(cls := "variant-icon", aria.hidden := true)(RankTrackId.variant(track).symbol),
        " ",
        lila.core.i18n.I18nKey(RankTrackId.variant(track).nameKey)()
      ),
      ol(cls := "user-top")(
        entries.zipWithIndex.map((entry, index) => row(entry, index + 1)),
        extra.nonEmpty.option(li(cls := "leaderboard__ellipsis", aria.hidden := true)("…")),
        extra.map((place, entry) => row(entry, place))
      ),
      personal match
        case None =>
          p(cls := "leaderboard__footer")(
            a(href := s"${routes.Auth.login.url}?referrer=${ctx.req.path}")(
              trans.site.loginToSeeYourRanking()
            )
          )
        case Some(XiangqiPersonalRank.Unplayed) =>
          p(cls := "leaderboard__footer")(
            a(href := (if track == RankTrackId.threeKingdoms then
                         "/play/room/threeKingdoms-v1-ranked-15+0-m60"
                       else if track == RankTrackId.xiangqi then "/"
                       else s"/?variant=${track.value}"))(
              trans.site.playRatedGameToGetRanked()
            )
          )
        case _ => emptyFrag
    )

  def bots(users: List[UserWithPerfs])(using Context) =
    val title = s"${users.size} Online bots"
    val aboutLink = a(href := routes.Cms.lonePage(lila.core.id.CmsPageKey("bot-accounts")))("About bots")
    val (featured, community) = users.partition(_.isVerified)
    Page(title)
      .css("bits.slist")
      .css("user.bot.list")
      .flag(_.fullScreen):
        main(cls := "page-menu")(
          bits.communityMenu("bots"),
          div(cls := "bots page-menu__content")(
            div(cls := "box box-pad bots__categ")(
              boxTop(h1("Featured bots")),
              h3("Try playing these innovative Xiangqi engines! These are our favourites."),
              div(cls := "bots__featured")(botGrid(featured))
            ),
            div(cls := "box box-pad bots__categ")(
              boxTop(h1("Community bots"), aboutLink),
              h3(
                "More Xiangqi engines created by the Lixiangqi community. They are hosted by their creators, and as such might not always be online."
              ),
              botGrid(community)
            )
          )
        )

  private def botGrid(users: List[UserWithPerfs])(using ctx: Context) = div(cls := "bots__list")(
    users.map: u =>
      div(cls := "bots__list__entry")(
        div(cls := "bots__list__entry__head")(
          userLink(u, withTitle = false, withOnline = u.isPatron),
          u.perfs.xiangqiRankCode.map: code =>
            div(cls := "bots__list__entry__rating rank")(code.value)
        ),
        u.profile
          .ifTrue(ctx.kid.no)
          .ifTrue(!u.marks.troll || ctx.is(u))
          .flatMap(_.nonEmptyBio)
          .map { bio => div(cls := "bots__list__entry__bio")(shorten(bio, 400)) },
        a(
          dataIcon := Icon.Swords,
          cls := List("bots__list__entry__play text" -> true),
          st.title := trans.challenge.challengeToPlay.txt(),
          href := s"${routes.Lobby.home}?user=${u.username}#friend"
        )(trans.site.play())
      )
  )
