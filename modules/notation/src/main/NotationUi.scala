package lila.notation
package ui

import play.api.libs.json.Json

import lila.ui.*

import ScalatagsTemplate.*

final class NotationUi(helpers: Helpers):
  import helpers.{ *, given }

  def show(scoreOption: Option[Score])(using Context) =
    Page(trans.notation.xiangqiNotationTraining.txt())
      .css("notationTrainer")
      .i18n(_.notation, _.storm, _.study)
      .js(pageModule(scoreOption))
      .csp(_.withPeer.withWebAssembly)
      .graph(
        title = "Xiangqi Notation trainer",
        url = routeUrl(routes.Notation.home),
        description = "Practice reading and writing valid Xiangqi moves in English or Chinese WXF notation."
      )
      .hrefLangs(LangPath(routes.Notation.home))
      .flag(_.zoom)
      .flag(_.zen)
      .body(preload)

  private val preload = main(id := "trainer")(
    div(cls := "trainer")(
      div(cls := "side"),
      div(cls := "main-board")(chessgroundBoard),
      div(cls := "table"),
      div(cls := "progress")
    )
  )

  private def pageModule(scoreOption: Option[lila.notation.Score])(using ctx: Context) =
    PageModule(
      "notationTrainer",
      Json.obj(
        "notationSystem" ->
          (if ctx.pref.xiangqiNotationStyle(ctx.lang) == lila.xiangqi.Xiangqi.NotationStyle.Chinese
           then "chinese"
           else "wxf"),
        "scores" -> Json.obj(
          "moveFromNotation" -> Json.obj(
            "red" -> (scoreOption.so(_.redPerspectiveMoveFromNotation): List[Int]),
            "black" -> (scoreOption.so(_.blackPerspectiveMoveFromNotation): List[Int]),
            "both" -> (scoreOption.so(_.bothPerspectivesMoveFromNotation): List[Int])
          ),
          "writeNotation" -> Json.obj(
            "red" -> (scoreOption.so(_.redPerspectiveWriteNotation): List[Int]),
            "black" -> (scoreOption.so(_.blackPerspectiveWriteNotation): List[Int]),
            "both" -> (scoreOption.so(_.bothPerspectivesWriteNotation): List[Int])
          )
        )
      )
    ).some
