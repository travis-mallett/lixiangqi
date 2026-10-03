package lila.xiangqi

import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.util.HexFormat

import Xiangqi.*

/** Evaluation identity includes the policy and full branch history, not just the final board. */
object XiangqiEvaluation:
  def game(position: Position): Either[String, Game] =
    if position.moves.size > UciPath.maxDepth then Left("Evaluation history exceeds the move limit")
    else XiangqiRules.game(position)

  def key(game: Game): String =
    val context = s"${game.ruleset.key}\n${game.states.head.fen}\n${game.moves.map(_.value).mkString(" ")}"
    "xiangqi-v1:" + HexFormat
      .of()
      .formatHex(MessageDigest.getInstance("SHA-256").digest(context.getBytes(UTF_8)))

  def validateVariation(
      game: Game,
      moves: List[Uci],
      mate: Option[Int],
      maxPlies: Int
  ): Either[String, Unit] =
    moves
      .foldLeft[Either[String, Game]](Right(game)): (acc, uci) =>
        acc.flatMap(g => XiangqiRules.move(g, uci).flatMap(g.applyMove))
      .flatMap: last =>
        val valid = mate.forall: value =>
          val plies = moves.size
          val matePlies = math.abs(value.toLong) * 2
          if plies == matePlies || plies == matePlies - 1 then
            val winner = if value > 0 then Side.Red else Side.Black
            last.state.mate && last.state.gameResult.winner.contains(winner)
          else plies < matePlies && matePlies > maxPlies
        Either.cond(valid, (), "Principal variation does not match its mate score")
