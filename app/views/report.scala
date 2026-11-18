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
    pending: PendingCounts,
    scanner: (String, Int)
)(using Context, Me) =
  ui.list.layout(s"Reports: $filter", filter, scores, pending)(views.mod.ui.reportMenu):
    frag(
      p(cls := "box-pad")(s"Attachment scanner · ${scanner._1} · ${scanner._2} pending"),
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
    )

def evidence(e: lila.report.Evidence, images: Set[String])(using Context, Me): Page =
  val i = e.item
  val review = i.status == "review requested"
  val handles = if review then List(i.parent) else i.attachments
  Page("Reported item").css("mod.report"):
    main(cls := "page-small box box-pad")(
      h1("Reported item"),
      p(i.resource, " · ", i.status, " · @", i.suspect.value),
      p("Item ", code(i.parent), " · Revision ", i.revision.toString),
      (!review).option(pre(i.text)),
      handles.map: id =>
        val url = s"/report/evidence/${e.id}?media=$id"
        details(cls := "reported-attachment")(
          summary("Show reported attachment"),
          images(id).option(img(src := url, alt := "Blurred evidence preview", attr("loading") := "lazy")),
          a(href := url, target := "_blank", rel := "noreferrer")(
            "Open attachment"
          )
        )
      ,
      review.option(
        div(
          postForm(action := s"/report/evidence/${e.id}?approve=true")(
            submitButton(cls := "button")("Approve for a fresh send")
          ),
          postForm(action := s"/report/evidence/${e.id}?approve=false")(
            submitButton(cls := "button button-red")("Keep blocked")
          )
        )
      )
    )
