package lila.game

import chess.ErrorStr
import monocle.syntax.all.*

object Rewind:

  def apply(game: CoreGame): Either[ErrorStr, Progress] =
    if game.xiangqi.moves.isEmpty then Left(ErrorStr("Cannot rewind a game without moves"))
    else
      val rewinded =
        game.xiangqi.copy(
          moves = game.xiangqi.moves.dropRight(1),
          wxf = game.xiangqi.wxf.dropRight(1),
          states = game.xiangqi.states.dropRight(1)
        )
      Right:
        val color = game.turnColor
        val newClock = game.clock.map(_.takeback).map { clk =>
          clk.updatePlayer(color): clkPlayer =>
            clkPlayer.setRemaining(game.clockHistory.flatMap(_(color).lastOption) | clkPlayer.limit)
        }
        val newGame = game.copy(
          players = game.players.map(_.removeTakebackProposition),
          xiangqi = rewinded,
          clock = newClock,
          binaryMoveTimes = game.binaryMoveTimes.map { binary =>
            val moveTimes = BinaryFormat.moveTime.read(binary, game.playedPlies)
            BinaryFormat.moveTime.write(moveTimes.dropRight(1))
          },
          loadClockHistory = _ => game.clockHistory.map(_.update(!color, _.dropRight(1))),
          movedAt = nowInstant,
          metadata = game.metadata.focus(_.drawOffers).modify(_.beforePly(chess.Ply(rewinded.state.ply)))
        )
        Progress(game, newGame)
