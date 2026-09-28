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
    // Read the winner from primary, including on retry after an uncertain write.
    retained <- analysisRepo.current(analysis.id).orFail("Saved analysis missing")
    _ <- retained.id.gameId.so: id =>
      gameRepo.game(id).flatMapz { prev =>
        val game = prev.focus(_.metadata.analysed).replace(true)
        for _ <- gameRepo.setAnalysed(game.id, true)
        yield Bus.pub(actorApi.AnalysisReady(game, retained))
      }
    _ <- sendAnalysisProgress(retained, complete = true)
  yield ()

  def progress(analysis: Analysis): Funit =
    analysisRepo
      .current(analysis.id)
      .flatMap:
        case Some(retained) => sendAnalysisProgress(retained, complete = true)
        case None => sendAnalysisProgress(analysis, complete = false)

  def foundSameHash(forId: Analysis.Id, same: Analysis, workHash: Array[Byte]): Funit =
    save(same.copy(id = forId), workHash)

  private def sendAnalysisProgress(analysis: Analysis, complete: Boolean): Funit =
    analysis.id match
      case Analysis.Id.Game(id) =>
        gameRepo.game(id).mapz { game =>
          Bus.pub(
            lila.tree.AnalysisProgress(
              id,
              () => makeProgressPayload(analysis, game, complete)
            )
          )
        }
      case Analysis.Id.Study(_, _) =>
        fuccess:
          Bus.pub(lila.tree.StudyAnalysisProgress(analysis, complete))
      case Analysis.Id.Catalog(_) => funit

  private def makeProgressPayload(
      analysis: Analysis,
      game: Game,
      complete: Boolean
  ): JsObject =
    Json.obj(
      "complete" -> complete,
      "depth" -> analysis.depth,
      "analysis" -> JsonView.bothPlayers(game.startedAtPly, analysis),
      "treeParts" -> XiangqiTreeJson(game, analysis.some, ExportOptions.default)
    )
