package lila.evalCache

import lila.xiangqi.Xiangqi.Game
import lila.xiangqi.XiangqiEvaluation

import lila.core.chess.MultiPv
import lila.tree.CloudEval

case class EvalCacheEntry(
    nbMoves: Int, // multipv cannot be greater than number of legal moves
    evals: List[CloudEval]
):
  // finds the best eval with at least multiPv pvs,
  // and truncates its pvs to multiPv.
  // Defaults to lower multiPv if no eval has enough pvs.
  def makeBestMultiPvEval(multiPv: MultiPv): Option[CloudEval] =
    evals
      .find(_.multiPv >= multiPv.atMost(nbMoves))
      .map(_.takePvs(multiPv))
      .orElse:
        evals.sortBy(-_.multiPv.value).headOption

opaque type Id = String
object Id extends OpaqueString[Id]:
  def apply(game: Game): Id = Id(XiangqiEvaluation.key(game))
