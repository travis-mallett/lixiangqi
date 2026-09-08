package views.report

import lila.app.UiEnv.*
import lila.report.ui.PendingCounts
import lila.rating.{ UserPerfsExt, XiangqiRank }
import lila.report.Report.WithSuspect
import lila.report.Room

val ui = lila.report.ui.ReportUi(helpers)(views.mod.ui.reportMenu)

def list(
    reports: List[WithSuspect],
    filter: String,
    scores: Room.Scores,
    pending: PendingCounts
)(using Context, Me) =
  ui.list.layout(s"Reports: $filter", filter, scores, pending)(views.mod.ui.reportMenu):
    ui.list.reportTable(reports)(
      bestPerfs = suspect =>
        import UserPerfsExt.*
        List(
          strong(
            suspect.perfs.xiangqiRank.fold("Unranked")(rank => XiangqiRank.catalog.code(rank.score).value)
          )
        )
      ,
      userMarks = views.mod.user.userMarks(_, none)
    )
