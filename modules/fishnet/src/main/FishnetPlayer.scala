package lila.fishnet

import chess.{ Black, Clock, White }
import scalalib.ThreadLocalRandom

import lila.common.LilaFuture

/** Submits AI turns through Lila's established Fishnet move-work boundary. */
final class FishnetPlayer(
    redis: FishnetRedis,
    gameRepo: lila.core.game.GameRepo,
    uciMemo: lila.core.game.UciMemo
)(using Executor, Scheduler):

  def apply(game: Game): Funit =
    game.aiLevel
      .so: level =>
        LilaFuture.delay(delayFor(game) | 0.millis):
          makeWork(game, level).addEffect(redis.request).void
      .recover:
        case error: Exception => logger.info(error.getMessage)

  private val delayFactor = 0.011f
  private val defaultClock = Clock(Clock.LimitSeconds(300), Clock.IncrementSeconds(0))

  private def delayFor(game: Game): Option[FiniteDuration] =
    if !game.bothPlayersHaveMoved then 2.seconds.some
    else
      for
        pov <- game.aiPov
        clock = game.clock | defaultClock
        totalTime = clock.estimateTotalTime.centis
        if totalTime > 20 * 100
        delay = clock.remainingTime(pov.color).centis.atMost(totalTime) * delayFactor
        accel = 1 - (game.ply.value - 20).atLeast(0).atMost(100) / 150f
        sleep = (delay * accel).atMost(500)
        if sleep > 25
        millis = sleep * 10
        randomized = millis + millis * (ThreadLocalRandom.nextDouble() - 0.5)
        divided = randomized / (if game.ply > 9 then 1 else 2)
      yield divided.toInt.millis

  private def makeWork(game: Game, level: Int): Fu[Work.Move] =
    if game.playable && !game.position.ended then
      if game.ply <= lila.core.fishnet.maxPlies then
        gameRepo
          .initialFen(game)
          .zip(uciMemo.get(game))
          .map: (initialFen, moves) =>
            Work.Move(
              _id = Work.makeId,
              game = Work.Game(
                id = game.id.value,
                initialFen = initialFen,
                studyId = none,
                variant = game.variant,
                moves = moves.mkString(" ")
              ),
              level =
                if level < 3 && game.clock.exists(_.config.limitSeconds < 60) then 3
                else level,
              clock = game.clock.map: clock =>
                Work.Clock(
                  wtime = clock.remainingTime(White).centis,
                  btime = clock.remainingTime(Black).centis,
                  inc = clock.incrementSeconds
                )
            )
      else fufail(s"[fishnet] Too many moves (${game.ply}), won't play ${game.id}")
    else fufail(s"[fishnet] invalid Xiangqi position on ${game.id}")
