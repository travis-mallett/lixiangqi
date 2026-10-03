package lila.study

import lila.tree.Analysis

/** Resolves analysis for the chapter being read. Inherited analysis is never saved to the chapter. */
final class ChapterAnalysis(
    getGame: GameId => Fu[Option[Game]],
    getAnalysis: Analysis.Id => Fu[Option[Analysis]]
)(using Executor):

  import ChapterAnalysis.*

  def apply(chapter: Chapter): Fu[Result] =
    // A chapter's own document is canonical. A request marker alone may mean
    // Fishnet has never picked up the work, so it must not hide usable source analysis.
    chapter.serverEval.isDefined
      .so(getAnalysis(Analysis.Id(chapter.studyId, chapter.id)))
      .flatMap:
        case Some(analysis)
            if chapter.root.gameAt(chapter.root.mainlinePath).exists(_.position == analysis.position) =>
          fuccess(Result(Some(analysis)))
        case _ => fromSource(chapter)

  private def fromSource(chapter: Chapter): Fu[Result] =
    chapter.setup.gameId
      .so: id =>
        getGame(id).flatMap:
          case Some(game) if matches(chapter, game) =>
            getAnalysis(Analysis.Id(game.id)).map:
              _.filter: analysis =>
                analysis.id == Analysis.Id(
                  game.id
                ) && analysis.valid && analysis.position == game.xiangqi.position &&
                  analysis.startPly == chapter.root.ply &&
                  analysis.infos.map(_.ply) == chapter.root.mainline.map(_.ply)
          case _ => fuccess(none)
      .map: analysis =>
        Result(analysis, analysis.flatMap(_.id.gameId))

object ChapterAnalysis:

  case class Result(analysis: Option[Analysis], sourceGame: Option[GameId] = None)

  private def matches(chapter: Chapter, game: Game): Boolean =
    game.finishedOrAborted && game.metadata.analysed && chapter.setup.gameId.contains(game.id) &&
      chapter.root.ruleset == game.xiangqi.ruleset &&
      chapter.root.fen.value == game.xiangqi.initialFen &&
      chapter.root.ply.value == game.xiangqi.states.head.ply &&
      chapter.root.mainline.map(_.move.uci.value) == game.xiangqi.moves.map(_.value).toList
