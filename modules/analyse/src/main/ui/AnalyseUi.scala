package lila.analyse
package ui

import chess.format.{ Fen, Uci }
import play.api.libs.json.*

import lila.ui.*
import lila.ui.ScalatagsTemplate.*

final class AnalyseUi(helpers: Helpers)(endpoints: AnalyseEndpoints):
  import helpers.*

  def miniSpan(fen: Fen.Board, color: Color = chess.White, lastMove: Option[Uci] = None) =
    chessgroundMini(fen, color, lastMove)(span)

  def explorerAndCevalConfig(using ctx: Context) =
    Json.obj(
      "explorer" -> Json.obj(
        "endpoint" -> endpoints.explorer,
        "tablebaseEndpoint" -> endpoints.tablebase,
        "showRatings" -> ctx.pref.showRatings
      ),
      "externalEngineEndpoint" -> endpoints.externalEngine
    )

  def titleOf(pov: Pov)(using Translate) =
    s"${playerText(pov.game.whitePlayer)} vs ${playerText(pov.game.blackPlayer)}: ${trans.site.analysis.txt()}"

  object bits:

    val dataPanel = attr("data-panel")

    def page(title: String): Page =
      Page(title)
        .flag(_.zoom)
        .flag(_.noRobots)
        .flag(_.crossSiteIsolation)
        .csp:
          cspExternalEngine.compose(_.withPeer.withInlineIconFont.withChessDbCn)

    def cspExternalEngine: Update[ContentSecurityPolicy] =
      _.withWebAssembly.withExternalEngine(endpoints.externalEngine)

    def analyseModule(mode: "userAnalysis" | "replay", json: JsObject) =
      PageModule("analyse.user", Json.obj("mode" -> mode, "cfg" -> json))

    val embedUserAnalysisBody = div(id := "main-wrap", cls := "is2d")(
      main(cls := "analyse")(
        div(cls := "analyse__board main-board")(chessgroundBoard),
        div(cls := "analyse__tools"),
        div(cls := "analyse__controls")
      )
    )
