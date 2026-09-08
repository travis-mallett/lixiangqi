package lila.web
package ui

import scalalib.model.Days
import lila.ui.*
import ScalatagsTemplate.{ *, given }

final class TopNav(helpers: Helpers):
  import helpers.{ *, given }

  private def linkTitle(url: String, name: Frag)(using ctx: Context) =
    if ctx.blind then h3(name) else a(href := url)(name)

  def apply()(using ctx: Context) =
    st.nav(id := "topnav", cls := "hover")(
      st.section(
        linkTitle(
          "/",
          frag(
            span(cls := "play")(trans.site.play()),
            span(cls := "home")("lixiangqi")
          )
        ),
        div(role := "group")(
          a(href := routes.Round.matchmaking("15+0-m90-30x3"))(
            if !ctx.isAuth then frag(trans.site.playRatedXiangqi(), " (sign-in required)")
            else trans.site.playRatedXiangqi()
          ),
          a(href := s"${langHref("/")}?any#ai")(trans.site.playAgainstComputer()),
          Option.when(ctx.noBot):
            frag(
              a(href := langHref(routes.Tournament.home))(trans.site.tournaments()),
              (ctx.kid.no && !ctx.me.exists(_.isPatron)).option:
                a(cls := "community-patron mobile-only", href := routes.Plan.index())(trans.patron.donate())
            )
        )
      ),
      Option.when(ctx.noBot):
        val puzzleUrl = langHref(routes.Puzzle.home.url)
        st.section(
          linkTitle(puzzleUrl, trans.site.puzzles()),
          div(role := "group")(
            a(href := puzzleUrl)(trans.site.puzzles()),
            a(href := langHref(routes.Puzzle.themes))(trans.puzzle.puzzleThemes()),
            a(href := routes.Puzzle.dashboard(Days(30), "home", none))(trans.puzzle.puzzleDashboard())
          )
        )
      ,
      st.section(
        linkTitle(routes.Notation.home.url, trans.site.learnMenu()),
        div(role := "group")(
          Option.when(ctx.noBot):
            frag(
              a(href := langHref(routes.Notation.home))(trans.notation.xiangqiNotation()),
              a(href := routes.Learn.ancientManuals)(
                if ctx.lang.language == "zh" then "古谱" else "Ancient Manuals"
              ),
              a(href := routes.Learn.xiangqiRankings)("About Xiangqi Rankings"),
              a(href := routes.Learn.specialRules)(if ctx.lang.language == "zh" then "特殊规则"
              else "Special Rules")
            )
          ,
          a(href := langHref(routes.Study.allDefault()))(trans.site.studyMenu()),
          ctx.kid.no.option(a(href := langHref(routes.Coach.all(1)))(trans.site.coaches()))
        )
      ),
      st.section:
        val tvUrl = langHref(routes.Tv.index.url)
        frag(
          linkTitle(tvUrl, trans.site.watch()),
          div(role := "group")(
            a(href := tvUrl)("Lixiangqi TV"),
            a(href := routes.Tv.games)(trans.site.currentGames()),
            ctx.noBot.option(a(href := langHref(routes.Video.index))(trans.site.videoLibrary()))
          )
        )
      ,
      st.section(
        linkTitle(routes.User.list.url, trans.site.community()),
        div(role := "group")(
          a(href := routes.User.list)(trans.site.players()),
          ctx.me.map(me => a(href := routes.Relation.following(me.username))(trans.site.friends())),
          a(href := routes.Team.home())(trans.team.teams()),
          ctx.kid.no.option(a(href := routes.ForumCateg.index)(trans.site.forum())),
          ctx.kid.no.option(a(href := langHref(routes.Ublog.communityAll()))(trans.site.blog())),
          (ctx.kid.no && ctx.me.exists(_.isPatron))
            .option(a(cls := "community-patron", href := routes.Plan.index())(trans.patron.donate()))
        )
      ),
      st.section(
        linkTitle(routes.UserAnalysis.index.url, trans.site.tools()),
        div(role := "group")(
          a(href := routes.UserAnalysis.index)(trans.site.analysis()),
          a(href := routes.GameCatalog.index)("Games Database"),
          a(href := routes.Importer.importGame)(trans.site.importGame()),
          a(href := routes.Search.index())(trans.search.advancedSearch())
        )
      )
    )
