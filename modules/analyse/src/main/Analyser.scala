package lila.analyse

import monocle.syntax.all.*
import play.api.libs.json.*

import lila.common.Bus
import lila.tree.{ Analysis, ExportOptions, XiangqiTreeJson }

final class Analyser(
    gameRepo: lila.core.game.GameRepo,
    analysisRepo: AnalysisRepo
)(using Executor)
    extends lila.tree.Analyser:

  export analysisRepo.{ byId, byGame as get }

  def save(analysis: Analysis, workHash: => Array[Byte]): Funit = for
    _ <- analysisRepo.save(analysis, analysis.studyId.isDefined.option(workHash))
    _ <- analysis.id.gameId.so: id =>
      gameRepo.game(id).flatMapz { prev =>
        val game = prev.focus(_.metadata.analysed).replace(true)
        for _ <- gameRepo.setAnalysed(game.id, true)
        yield Bus.pub(actorApi.AnalysisReady(game, analysis))
      }
    _ <- sendAnalysisProgress(analysis, complete = true)
  yield ()

  def progress(analysis: Analysis): Funit = sendAnalysisProgress(analysis, complete = false)

  def foundSameHash(forId: Analysis.Id, same: Analysis, workHash: Array[Byte]): Funit =
    save(same.copy(id = forId), workHash)

  private def sendAnalysisProgress(analysis: Analysis, complete: Boolean): Funit =
    analysis.id match
      case Analysis.Id.Game(id) =>
        gameRepo.game(id).mapz { game =>
          Bus.pub(
            lila.tree.AnalysisProgress(
              id,
              () => makeProgressPayload(analysis, game)
            )
          )
        }
      case _ =>
        fuccess:
          Bus.pub(lila.tree.StudyAnalysisProgress(analysis, complete))

  private def makeProgressPayload(
      analysis: Analysis,
      game: Game
  ): JsObject =
    Json.obj(
      "analysis" -> JsonView.bothPlayers(game.startedAtPly, analysis),
      "treeParts" -> XiangqiTreeJson(game, analysis.some, ExportOptions.default)
    )
