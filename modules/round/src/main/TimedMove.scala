package lila.round

import chess.{ Centis, MoveMetrics, Timestamp, Timestamper }

import lila.game.GameExt.{ applyMove, firstMoveDeadlineMillis }
import lila.game.Progress
import lila.xiangqi.{ Xiangqi, XiangqiRules }

private[round] enum TimedMove:
  case NoStart, Flagged
  case Applied(progress: Progress, move: Xiangqi.MoveResult, compensatedLag: Option[Centis])

private[round] object TimedMove:
  def apply(
      game: Game,
      uci: Xiangqi.Uci,
      blur: Boolean,
      metrics: MoveMetrics,
      receivedAt: Long
  ): Either[String, TimedMove] =
    if !game.isSwiss && game.firstMoveDeadlineMillis.exists(_ <= receivedAt) then Right(NoStart)
    else
      // Both limits and lag compensation must see the same instant, even if the
      // round mailbox or legality check took time. Resume the next clock at handoff.
      val atReceipt = game.clock
        .filter(_.isRunning)
        .fold(game): clock =>
          val receipt = new Timestamper:
            val now = Timestamp(receivedAt.max(clock.timer.get.value))
          game.copy(clock = Some(clock.copy(timestamper = receipt)))
      if atReceipt.outoftime(withGrace = true) then Right(Flagged)
      else
        for
          move <- XiangqiRules.move(game.xiangqi, uci)
          next <- game.xiangqi.applyMove(move)
        yield
          val stepped = atReceipt.clock.map(_.step(metrics, gameActive = !next.state.ended))
          if stepped.exists(s =>
              s.value.outOfTime(game.turnColor, withGrace = false) ||
                atReceipt.moveTimeOutAfterCompensation(s.compensated)
            )
          then Flagged
          else
            val clock = game.clock
              .zip(stepped)
              .map: (original, step) =>
                step.value.copy(
                  timestamper = original.timestamper,
                  timer = step.value.timer.map(_ => original.timestamper.now)
                )
            Applied(game.applyMove(next, move, clock, blur), move, stepped.flatMap(_.compensated))
