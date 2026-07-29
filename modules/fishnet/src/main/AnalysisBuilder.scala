package lila.fishnet

import chess.Ply
import chess.format.pgn.SanStr

import lila.tree.{ Analysis, Eval, Info }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

import JsonApi.Request.Evaluation
import Evaluation.EvalOrSkip

/** Converts Pikafish/Fishnet evaluations into Lila's native analysis model. */
final private class AnalysisBuilder(evalCache: IFishnetEvalCache)(using Executor):

  def apply(client: Client, work: Work.Analysis, evals: List[EvalOrSkip]): Fu[Analysis] =
    partial(client, work, evals.map(some), isPartial = false)

  def partial(
      client: Client,
      work: Work.Analysis,
      evals: List[Option[EvalOrSkip]],
      isPartial: Boolean = true
  ): Fu[Analysis] =
    evalCache
      .evals(work)
      .flatMap: cachedFull =>
        val cached = if isPartial then cachedFull - 0 else cachedFull
        val merged = mergeEvalsAndCached(work, evals, cached)
        val initialFen = work.game.initialFen.fold(Xiangqi.startFen)(_.value)
        XiangqiRules
          .game(Xiangqi.Position(initialFen, work.game.uciList.toVector))
          .fold(
            fufail,
            game =>
              val analysis = Analysis(
                id = Analysis.Id(work.game.studyId, work.game.id),
                infos = makeInfos(merged, game, work.startPly),
                startPly = work.startPly,
                fk = (!client.lichess).option(client.key.value),
                date = nowInstant,
                nodesPerMove = work.origin.map(_.nodesPerMove)
              )
              if !analysis.valid then fufail(s"Xiangqi analysis for ${work.game.id} is empty")
              else if !isPartial && analysis.emptyRatio >= 1d / 10 then
                fufail:
                  s"Xiangqi analysis for ${work.game.id} has ${analysis.nbEmptyInfos} empty infos out of ${analysis.infos.size}"
              else fuccess(analysis)
          )

  private def mergeEvalsAndCached(
      work: Work.Analysis,
      evals: List[Option[EvalOrSkip]],
      cached: Map[Int, Evaluation]
  ): List[Option[Evaluation]] =
    evals.mapWithIndex:
      case (None, i) => cached.get(i)
      case (Some(EvalOrSkip.Evaluated(eval)), i) => cached.getOrElse(i, eval).some
      case (_, i) =>
        cached
          .get(i)
          .orElse:
            logger.error(s"Missing cached eval for skipped position at index $i in $work")
            none

  private def makeInfos(
      evals: List[Option[Evaluation]],
      game: Xiangqi.Game,
      startedAtPly: Ply
  ): List[Info] =
    evals
      .filterNot(_.exists(_.isCheckmate))
      .sliding(2)
      .toList
      .zip(game.moves)
      .mapWithIndex:
        case ((List(Some(before), Some(after)), move), index) =>
          val stateBefore = game.states.lift(index).getOrElse(game.states.head)
          val variation =
            before.cappedPv match
              case first :: rest if first != move => renderVariation(stateBefore.fen, first :: rest)
              case _ => Nil
          val best = before.cappedPv.headOption.filter(_ != move).map(_.value)
          val info = Info(
            ply = startedAtPly + index + 1,
            eval = Eval(after.score.cp, after.score.mate, best),
            variation = variation.map(SanStr.apply)
          )
          if info.ply.isOdd then info.invert else info
        case ((_, _), index) => Info(startedAtPly + index + 1, lila.tree.evals.empty, Nil)

  private def renderVariation(initialFen: String, moves: List[Xiangqi.Uci]): List[String] =
    moves
      .foldLeft((initialFen, List.empty[String], true)):
        case ((fen, notation, false), _) => (fen, notation, false)
        case ((fen, notation, true), move) =>
          XiangqiRules.move(Xiangqi.Position(initialFen = fen), move) match
            case Left(_) => (fen, notation, false)
            case Right(result) => (result.fen, notation :+ result.notation, true)
      ._2
