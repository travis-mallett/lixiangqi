package lila.tree

import chess.Status
import lila.xiangqi.Xiangqi.{ Side, State }

object StatusText:

  import Status.*

  def apply(status: Status, win: Option[Side], state: State): String =
    status match
      case Aborted => "Game was aborted."
      case Mate =>
        s"${winner(win)} wins by ${
            if state.termination.contains("stalemate") then "stalemate" else "checkmate"
          }."
      case Resign => s"${loser(win)} resigns."
      case UnknownFinish if win.isDefined => s"${winner(win)} wins."
      case Stalemate => s"${winner(win)} wins by stalemate."
      case Timeout if win.isDefined => s"${loser(win)} left the game."
      case Timeout | Draw => "The game is a draw."
      case Outoftime =>
        win match
          case Some(value) => s"${name(value)} wins on time."
          case None => "The game is a draw."
      case NoStart => s"${winner(win)} wins by forfeit."
      case Cheat => "Cheat detected."
      case VariantEnd =>
        state.termination match
          case Some("forced-variation") => s"${loser(win)} cannot make the required variation."
          case Some(reason) => s"Game ends by Xiangqi adjudication: $reason."
          case None => "Game ends by Xiangqi adjudication."
      case _ => ""

  private def name(side: Side): String = if side.red then "Red" else "Black"
  private def winner(win: Option[Side]) = win.fold("")(name)
  private def loser(win: Option[Side]) = winner(win.map(!_))
