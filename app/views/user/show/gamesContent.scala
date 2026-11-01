package views.user.show

import scalalib.paginator.Paginator

import lila.app.UiEnv.{ *, given }
import lila.app.mashup.GameHistoryEntry

object gamesContent:

  def apply(
      u: User,
      nbs: lila.app.mashup.UserInfo.NbGames,
      pager: Paginator[GameHistoryEntry],
      filters: lila.game.GameFilterMenu,
      filterName: String
  )(using ctx: Context) =
    val pageTitle =
      page.browserTitle(page.gamesTitle(u, nbs, filters.current, pager.currentPage))
    frag(
      div(
        cls := "number-menu number-menu--tabs menu-box-pop",
        id := "games",
        attr("data-page-title") := pageTitle
      )(
        filters.list.map: f =>
          a(
            cls := s"nm-item to-${f.name}${(filters.current == f).so(" active")}",
            href := routes.User.games(u.username, f.name)
          )(page.userGameFilterTitle(u, nbs, f))
      ),
      nbs.crosstable
        .ifTrue(filters.current.name == "me")
        .map:
          views.game.ui.crosstable(_, none)
      ,
      div(cls := "search__result")(
        if filterName == "search" then
          if pager.nbResults > 0 then
            frag(
              div(cls := "search__status")(
                strong(trans.search.gamesFound.plural(pager.nbResults, pager.nbResults.localize))
              ),
              div(cls := "search__rows infinite-scroll")(
                widgets(pager.currentPageResults, u),
                pagerNext(pager, np => routes.User.games(u.username, filterName, np).url)
              )
            )
          else div(cls := "search__status")(strong(trans.site.noGameFound.txt()))
        else
          div(
            cls := List(
              "games infinite-scroll" -> true,
              "now-playing center" -> (filterName == "playing" && pager.nbResults > 2)
            )
          )(
            if filterName == "playing" && pager.nbResults > 2 then
              pager.currentPageResults
                .flatMap {
                  case GameHistoryEntry.Duel(g) => Pov(g, u)
                  case _ => None
                }
                .map: pov =>
                  views.game.mini(pov)(cls := "paginated")
            else widgets(pager.currentPageResults, u),
            (filterName == "playing" && pager.nbResults > 2).option(pager.currentPageResults.collect {
              case GameHistoryEntry.Kingdoms(g) => views.threeKingdoms.widget(g)
            }),
            pagerNext(pager, np => routes.User.games(u.username, filterName, np).url)
          )
      )
    )

  private def widgets(games: Seq[GameHistoryEntry], user: User)(using ctx: Context): Frag =
    games.map:
      case GameHistoryEntry.Duel(game) => views.game.widgets(Seq(game), user.some, ownerLink = ctx.is(user))
      case GameHistoryEntry.Kingdoms(game) => views.threeKingdoms.widget(game)
