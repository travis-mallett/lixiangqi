package lila.analyse

import chess.Ply
import chess.eval.Eval.{ Cp, Mate }
import chess.format.pgn.SanStr
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
    game.moves.zipWithIndex
      .map: (move, index) =>
        val before = evals.lift(index).flatten
        val after = evals.lift(index + 1).flatten
        val best = before.flatMap(_.pv.headOption).filter(_ != move)
        val variation = best.isDefined.so:
          before.toList.flatMap(e => renderVariation(game.states(index).fen, e.pv.take(Info.LineMaxPlies)))
        val info = Info(
          startPly + index + 1,
          Eval(after.flatMap(_.cp), after.flatMap(_.mate), best.map(_.value)),
          variation.map(SanStr.apply)
        )
        if game.states(index + 1).turn == Xiangqi.Side.Black then info.invert else info
      .toList

  private def renderVariation(initialFen: String, moves: List[Xiangqi.Uci]): List[String] =
    moves
      .foldLeft((initialFen, List.empty[String], true)):
        case ((fen, notation, false), _) => (fen, notation, false)
        case ((fen, notation, true), move) =>
          XiangqiRules.move(Xiangqi.Position(initialFen = fen), move) match
            case Left(_) => (fen, notation, false)
            case Right(result) => (result.fen, notation :+ result.notation, true)
      ._2

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
