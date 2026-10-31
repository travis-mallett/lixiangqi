package lila.xiangqi

import Xiangqi.*
import adjudication.AdjudicationPolicy

/** The 7x7 Mini Xiangqi discipline implemented by Fairy-Stockfish. Movement is owned by XiangqiRules; this
  * policy owns history-dependent endings.
  */
object MiniXiangqiRules extends AdjudicationPolicy:
  val startFen = "rcnkncr/p1ppp1p/7/7/7/P1PPP1P/RCNKNCR w - - 0 1"

  def initial(state: State): State =
    if !state.ended && state.fen.split(' ')(4).toInt >= 100 then finish(state, None, "no-progress")
    else state

  def afterMove(game: Game, move: MoveResult): State =
    val state = move.state
    if state.ended then state
    else
      val states = game.states :+ state
      def key(s: State) = s.fen.split(' ').take(2).mkString(" ")
      val repeated = states.indices.filter(i => key(states(i)) == key(state)).takeRight(3)
      if repeated.size == 3 then
        val cycle = states.drop(repeated.head + 1)
        val checking = Side.values.filter: side =>
          val turns = cycle.filter(_.turn == !side)
          turns.nonEmpty && turns.forall(_.check)
        val winner = if checking.length == 1 then Some(!checking.head) else None
        finish(state, winner, if winner.isDefined then "perpetual-check" else "repetition")
      else if state.fen.split(' ')(4).toInt >= 100 then finish(state, None, "no-progress")
      else state

  private def finish(state: State, winner: Option[Side], reason: String): State =
    state.copy(
      legalMoves = Vector.empty,
      gameResult = winner.fold(Result.Draw)(_.fold(Result.RedWin, Result.BlackWin)),
      immediateEnd = Ending(true, 0),
      optionalEnd = Ending(false, 0),
      termination = Some(reason)
    )
