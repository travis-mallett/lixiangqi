package lila.user
package ui

import lila.core.perf.UserWithPerfs
import lila.core.rank.RankScore.*
import lila.ui.*
import lila.rating.XiangqiRank
import lila.rating.UserPerfsExt.*

import ScalatagsTemplate.{ *, given }
import scalalib.model.Days

final class UserShowSide(helpers: Helpers):
  import helpers.{ *, given }

  def apply(
      u: UserWithPerfs,
      active: Option[PerfKey]
  )(using ctx: Context) =

    def showXiangqiRank =
      val rank = u.perfs.xiangqiRank
      div(
        dataIcon := Icon.Crown,
        cls := List("xiangqi-rank" -> true, "empty" -> rank.isEmpty)
      )(
        span(
          h3("Xiangqi"),
          st.rating(
            strong(rank.fold("Unranked")(perf => XiangqiRank.catalog.code(perf.score).value)),
            ctx
              .is(u)
              .option:
                rank.map: perf =>
                  span(cls := "rank-detail")(
                    " ",
                    perf.score.value,
                    " points · ",
                    s"${perf.wins}-${perf.draws}-${perf.losses}"
                  )
          )
        )
      )

    def showPerf(perf: Perf, pk: PerfKey) =
      val isPuzzle = pk == PerfKey.puzzle
      a(
        dataIcon := pk.perfIcon,
        title := pk.perfDesc.txt(),
        cls := List(
          "empty" -> perf.isEmpty,
          "active" -> active.contains(pk)
        ),
        href := ctx.pref.showRatings.so:
          if isPuzzle
          then
            val other = ctx.isnt(u).option(u.username)
            routes.Puzzle.dashboard(Days(30), "home", other).url
          else routes.User.perfStat(u.username, pk).url
        ,
        span(
          h3(pk.perfTrans),
          if isPuzzle && lila.rating.ratingApi.dubiousPuzzle(u.perfs) && ctx.isnt(u) && ctx.pref.showRatings
          then st.rating(strong("?"))
          else
            st.rating(
              ctx.pref.showRatings.option(
                frag(
                  if perf.glicko.clueless then strong("?")
                  else
                    strong(
                      perf.glicko.intRating,
                      perf.provisional.yes.option("?")
                    )
                  ,
                  " ",
                  perf.glicko.clueless.not.so(ratingProgress(perf.progress)),
                  " "
                )
              ),
              span(
                if pk == PerfKey.puzzle then trans.site.nbPuzzles.plural(perf.nb, perf.nb.localize)
                else trans.site.nbGames.plural(perf.nb, perf.nb.localize)
              )
            )
        ),
        ctx.pref.showRatings.option(iconTag(Icon.PlayTriangle))
      )

    div(cls := "side sub-ratings")(
      (!u.lame || ctx.is(u) || Granter.opt(_.AccountInfo)).option(
        frag(
          showXiangqiRank,
          u.noBot.option(
            frag(
              hr,
              showPerf(u.perfs.puzzle, PerfKey.puzzle)
            )
          )
        )
      )
    )
