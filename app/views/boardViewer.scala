package views

import lila.app.UiEnv.{ *, given }
import play.api.libs.json.{ Json, JsObject }

object boardViewer:
  def apply(data: JsObject)(using ctx: EmbedContext) =
    val labels = Json.obj(
      "first" -> trans.site.first.txt(),
      "previous" -> trans.site.previous.txt(),
      "next" -> trans.site.next.txt(),
      "last" -> trans.site.last.txt(),
      "flip" -> trans.site.flipBoard.txt(),
      "board" -> trans.site.board.txt(),
      "pieces" -> trans.site.pieceSet.txt(),
      "sound" -> trans.site.sound.txt(),
      "moves" -> trans.site.moves.txt(),
      "start" -> trans.site.start.txt(),
      "analysis" -> trans.site.analysis.txt()
    )
    views.base.embed.minimal(
      title = "LiXiangQi",
      cssKeys = List("viewer.embed"),
      csp = _.withExternalEngine(env.fishnet.explorerEndpoint),
      modules = esmInitObj(
        "viewer.embed",
        data ++ Json.obj(
          "labels" -> labels,
          "boardTheme" -> ctx.boardTheme,
          "pieceSet" -> ctx.pieceSet,
          "explorerEndpoint" -> env.fishnet.explorerEndpoint
        )
      )
    )(div(id := "xiangqi-embed"))
