package lila.user
package ui

import lila.core.perf.UserWithPerfs
import lila.core.rank.RankCode.*
import lila.rating.UserPerfsExt.*
import lila.ui.*

import ScalatagsTemplate.{ *, given }

final class UserList(helpers: Helpers, bits: UserBits):
  import helpers.{ *, given }

  def page(
      online: List[UserWithPerfs],
      leaderboard: Frag
  )(using ctx: Context) =
    Page(trans.site.players.txt())
      .css("user.list")
      .css("lobby")
      .flag(_.fullScreen)
      .graph(
        title = "Xiangqi players and leaderboard",
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
              leaderboard
            )
          )
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
