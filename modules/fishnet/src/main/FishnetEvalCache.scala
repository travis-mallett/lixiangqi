package lila.fishnet

import JsonApi.Request.Evaluation
import lila.tree.CloudEval
import lila.xiangqi.Xiangqi

trait IFishnetEvalCache:
  def skipPositions(work: Work.Analysis): Fu[List[Int]]
  def evals(work: Work.Analysis): Fu[Map[Int, Evaluation]]

/** Cloud scores are Red-relative; the worker boundary uses the side to move. */
final private class FishnetEvalCache(getSinglePvEval: CloudEval.GetSinglePvEval)(using Executor)
    extends IFishnetEvalCache:
  def skipPositions(work: Work.Analysis): Fu[List[Int]] = cached(work).map(_.keys.toList.sorted)
  def evals(work: Work.Analysis): Fu[Map[Int, Evaluation]] = cached(work)

  private def cached(work: Work.Analysis): Fu[Map[Int, Evaluation]] =
    val game = work.game.nativeGame
    game.states.indices.toList
      .sequentially { index =>
        val position = game.copy(
          moves = game.moves.take(index),
          wxf = game.wxf.take(index),
          states = game.states.take(index + 1)
        )
        getSinglePvEval(position).map(
          _.filter(e => e.depth.value >= 20 && e.knodes.intNodes >= work.nodesPerMove).map { value =>
            val line = value.pvs.head
            val score = Evaluation.Score(line.score.cp, line.score.mate).invertIf(position.state.turn.black)
            index -> Evaluation(
              line.moves.value.toList,
              score,
              None,
              Some(value.knodes.intNodes),
              None,
              Some(value.depth)
            )
          }
        )
      }
      .map(_.flatten.toMap)

object FishnetEvalCache:
  val mock: IFishnetEvalCache = new:
    def skipPositions(work: Work.Analysis): Fu[List[Int]] = fuccess(Nil)
    def evals(work: Work.Analysis): Fu[Map[Int, Evaluation]] = fuccess(Map.empty)
