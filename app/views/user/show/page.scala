package views.user
package show

import play.api.data.Form

import lila.app.UiEnv.{ *, given }
import lila.app.mashup.UserInfo
import lila.core.data.SafeJsonStr
import lila.game.GameFilter
import lila.core.rank.RankCode.*
import lila.rating.UserPerfsExt.*

lazy val ui = lila.user.ui.UserShow(helpers, bits)

object page:

  lazy val side = lila.user.ui.UserShowSide(helpers)

  private def indexable(u: User) = u.isVerified || u.count.game >= 10

  def activity(
      activities: Seq[lila.activity.ActivityView],
      info: UserInfo,
      social: UserInfo.Social
  )(using Context) =
    val u = info.user
    Page(activityTitle(u))
      .graph(
        OpenGraph(
          image = staticAssetUrl("logo/lichess-tile-wide.png").some,
          title = u.perfs.xiangqiRankCode.fold(u.titleUsername)(code => s"${code.value} ${u.titleUsername}"),
          url = routeUrl(routes.User.show(u.username)),
          description = ui.describeUser(u)
        )
      )
      .js(pageModule(info))
      .js(esModules())
      .js(isGranted(_.AccountInfo).option(esmInit("mod.autolink")))
      .css("user.show")
      .css(isGranted(_.UserModView).option("mod.user"))
      .flag(_.noRobots, !indexable(u)):
        main(cls := "page-menu", ui.dataUsername := u.username)(
          st.aside(cls := "page-menu__menu")(side(u, none)),
          div(cls := "page-menu__content box user-show")(
            views.user.show.header(u, info, UserInfo.Angle.Activity, social),
            div(cls := "angle-content")(views.activity(u, activities))
          )
        )

  def games(
      info: UserInfo,
      games: scalalib.paginator.Paginator[lila.app.mashup.GameHistoryEntry],
      filters: lila.game.GameFilterMenu,
      searchForm: Option[Form[?]],
      social: UserInfo.Social
  )(using Context) =
    val u = info.user
    Page(gamesTitle(u, info.nbs, filters.current, games.currentPage))
      .js(pageModule(info))
      .js(esModules(filters.current.name == "search"))
      .css("user.show")
      .css((filters.current.name == "search").option("user.show.search"))
      .css(isGranted(_.UserModView).option("mod.user"))
      .flag(_.noRobots, !indexable(u)):
        main(cls := "page-menu", ui.dataUsername := u.username)(
          st.aside(cls := "page-menu__menu")(side(u, none)),
          div(cls := "page-menu__content box user-show")(
            views.user.show.header(u, info, UserInfo.Angle.Games(searchForm), social),
            div(cls := "angle-content"):
              gamesContent(u, info.nbs, games, filters, filters.current.name)
          )
        )

  def activityTitle(u: User)(using Translate): String =
    s"${u.username} : ${trans.activity.activity.txt()}"

  def gamesTitle(u: User, nbs: UserInfo.NbGames, filter: GameFilter, currentPage: Int)(using
      Translate
  ): String =
    val filterName = userGameFilterTitleNoTag(u, nbs, filter)
    val pageName = (currentPage > 1).so(s" - page $currentPage")
    s"${u.username} $filterName$pageName"

  def browserTitle(title: String)(using Context): String = views.base.page.browserTitle(Page(title))

  private def esModules(withSearch: Boolean = false)(using Context): EsmList =
    infiniteScrollEsmInit
      ++ esmInit("user")
      ++ esmInit("threeKingdoms.mini")
      ++ Esm("bits.dropdownOverflow")
      ++ withSearch.so(Esm("bits.gameSearch"))
      ++ isGranted(_.UserModView).so(Esm("mod.user"))

  private def pageModule(info: UserInfo): Option[PageModule] =
    info.ratingChart.map: rc =>
      PageModule("chart.ratingHistory", SafeJsonStr(s"""{"data":$rc}"""))

  def deleted(canCreate: Boolean) =
    Page("No such player"):
      main(cls := "page-small box box-pad page")(
        h1(cls := "box__top")("No such player"),
        div(
          p("This username doesn't match any Lixiangqi player."),
          canCreate.not.option(p("It cannot be used to create a new account."))
        )
      )

  def userGameFilterTitle(u: User, nbs: UserInfo.NbGames, filter: GameFilter)(using
      Context,
      Translate
  ): Frag =
    if filter == GameFilter.search then frag(iconTag(Icon.Search), br, trans.search.advancedSearch())
    else lila.web.ui.bits.splitNumber(userGameFilterTitleNoTag(u, nbs, filter))

  def userGameFilterTitleNoTag(u: User, nbs: UserInfo.NbGames, filter: GameFilter)(using Translate): String =
    import ui.transLocalize
    filter match
      case GameFilter.jieqi => "Jieqi (揭棋)"
      case GameFilter.minixiangqi => trans.site.miniXiangqi.txt()
      case GameFilter.manchu => trans.site.manchu.txt()
      case GameFilter.threeKingdoms => trans.site.threeKingdoms.txt()
      case GameFilter.all => transLocalize(trans.site.nbGames, u.count.game)
      case GameFilter.me => nbs.withMe.so { transLocalize(trans.site.nbGamesWithYou, _) }
      case GameFilter.ranked => transLocalize(trans.site.nbRanked, u.count.ranked)
      case GameFilter.win => transLocalize(trans.site.nbWins, u.count.win)
      case GameFilter.loss => transLocalize(trans.site.nbLosses, u.count.loss)
      case GameFilter.draw => transLocalize(trans.site.nbDraws, u.count.draw)
      case GameFilter.playing => transLocalize(trans.site.nbPlaying, nbs.playing)
      case GameFilter.bookmark => transLocalize(trans.site.nbBookmarks, nbs.bookmark)
      case GameFilter.imported => transLocalize(trans.site.nbImportedGames, nbs.imported)
      case GameFilter.search => trans.search.advancedSearch.txt()
