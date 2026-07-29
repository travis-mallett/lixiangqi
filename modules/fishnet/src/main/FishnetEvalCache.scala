package lila.fishnet

import JsonApi.Request.Evaluation

trait IFishnetEvalCache:
  def skipPositions(game: Work.Game): Fu[List[Int]]
  def evals(work: Work.Analysis): Fu[Map[Int, Evaluation]]

/** Evaluation caching remains a Fishnet concern.
  *
  * Lila's existing cloud-evaluation cache is keyed by scalachess positions and cannot safely identify 9x10
  * Xiangqi positions. Until the cache schema is converted, workers receive every position and no incompatible
  * chess cache entry is consumed.
  */
final private class FishnetEvalCache extends IFishnetEvalCache:
  def skipPositions(game: Work.Game): Fu[List[Int]] = fuccess(Nil)
  def evals(work: Work.Analysis): Fu[Map[Int, Evaluation]] = fuccess(Map.empty)

object FishnetEvalCache:
  val mock: IFishnetEvalCache = new:
    def skipPositions(game: Work.Game): Fu[List[Int]] = fuccess(Nil)
    def evals(work: Work.Analysis): Fu[Map[Int, Evaluation]] = fuccess(Map.empty)
