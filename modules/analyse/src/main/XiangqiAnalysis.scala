package lila.analyse

import chess.Ply
import chess.eval.Eval.{ Cp, Mate }
import play.api.libs.json.*

import lila.tree.{ Analysis, Eval, Info }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

/** One projection for Fishnet and offline full-game Pikafish searches. Scores arrive from the side to move;
  * persisted infos are always from Red's perspective.
  */
object XiangqiAnalysis:
  case class Evaluation(cp: Option[Cp], mate: Option[Mate], pv: List[Xiangqi.Uci], depth: Option[Int])

  def depth(evals: List[Option[Evaluation]]): Option[Int] =
    val searched = evals.flatten.filterNot(_.mate.contains(Mate(0)))
    Option.when(evals.forall(_.isDefined) && searched.nonEmpty && searched.forall(_.depth.exists(_ > 0)))(
      searched.flatMap(_.depth).min
    )

  def infos(game: Xiangqi.Game, evals: List[Option[Evaluation]], startPly: Ply): List[Info] =
    require(evals.size == game.moves.size + 1, "Analysis must cover the complete game history")
    evals.zipWithIndex.foreach: (evaluation, index) =>
      evaluation.foreach: evaluation =>
        val prefix = game.copy(
          moves = game.moves.take(index),
          wxf = game.wxf.take(index),
          states = game.states.take(index + 1)
        )
        require(
          prefix.state.ended || evaluation.pv.nonEmpty,
          s"Missing principal variation at ply ${prefix.state.ply}"
        )
        XiangqiRules
          .variation(prefix, evaluation.pv.toVector)
          .fold(
            error =>
              throw IllegalArgumentException(
                s"Invalid principal variation at ply ${prefix.state.ply}: $error"
              ),
            _ => ()
          )
    game.moves.zipWithIndex
      .map: (move, index) =>
        val before = evals.lift(index).flatten
        val after = evals.lift(index + 1).flatten
        val best = before.flatMap(_.pv.headOption).filter(_ != move)
        val variation = best.isDefined.so:
          before.toList.flatMap(_.pv.take(Info.LineMaxPlies))
        val info = Info(
          startPly + index + 1,
          Eval(after.flatMap(_.cp), after.flatMap(_.mate), best.map(_.value)),
          variation
        )
        if game.states(index + 1).turn == Xiangqi.Side.Black then info.invert else info
      .toList

  def json(analysis: Analysis): JsObject =
    Json.obj(
      "id" -> analysis.id.value,
      "depth" -> analysis.depth,
      "infos" -> analysis.infos.map: info =>
        Json
          .obj("ply" -> info.ply.value, "variation" -> info.variation.map(_.value))
          .add("cp", info.cp.map(_.value))
          .add("mate", info.mate.map(_.value))
          .add("best", info.best)
    )
