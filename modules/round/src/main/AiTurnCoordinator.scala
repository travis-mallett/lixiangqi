package lila.round

import chess.Clock

import lila.common.Bus
import lila.core.fishnet.{ AiMoveRequestId, AiTurnKey, FishnetMoveRequest }
import lila.round.RoundGame.playableByAi

/** Owns delivery state for one round actor's AI turns.
  *
  * Redis delivery is intentionally at-least-once. Correctness comes from the round actor comparing every due
  * message and result with the authoritative game in its GameProxy. The worker lease is only a computation
  * optimization. All methods are called from the round actor mailbox.
  */
private[round] final class AiTurnCoordinator(
    scheduleDue: (FiniteDuration, AiTurnKey) => Unit,
    tooManyPlies: () => Unit,
    publish: FishnetMoveRequest => Unit = Bus.pub(_),
    currentTimeMillis: () => Long = () => nowMillis
):

  import AiTurnCoordinator.*

  private var pending: Option[Pending] = None

  def observe(game: Game, force: Boolean = false): Unit =
    currentKey(game) match
      case None => pending = none
      case Some(key) =>
        pending match
          case Some(current) if current.key == key =>
            val now = currentTimeMillis()
            if force && current.lastAttemptAt.forall(now - _ >= forceDebounce.toMillis) then
              submit(game, current, now)
          case _ =>
            val delay = thinkDelay(game) | Duration.Zero
            val now = currentTimeMillis()
            val next = Pending(
              key,
              requestId = AiMoveRequestId.random(),
              attempts = 0,
              nextAttemptAt = now + delay.toMillis,
              lastAttemptAt = None
            )
            pending = next.some
            if force then submit(game, next, now)
            else scheduleDue(delay, key)

  def due(game: Game, key: AiTurnKey): Unit =
    pending match
      case Some(current) if current.key == key && currentKey(game).contains(key) =>
        val now = currentTimeMillis()
        if now >= current.nextAttemptAt then submit(game, current, now)
      case _ => observe(game)

  def tick(game: Game): Unit =
    observe(game)
    pending.foreach: current =>
      val now = currentTimeMillis()
      if now >= current.nextAttemptAt then submit(game, current, now)

  def failed(
      game: Game,
      key: AiTurnKey,
      requestId: AiMoveRequestId,
      retryImmediately: Boolean
  ): Unit =
    if currentKey(game).contains(key) then
      pending = pending
        .filter(current => current.key == key && current.requestId == requestId)
        .map: current =>
          current.copy(
            nextAttemptAt = if retryImmediately then currentTimeMillis() else current.nextAttemptAt
          )

  def accepts(game: Game, key: AiTurnKey, requestId: AiMoveRequestId): Boolean =
    currentKey(game).contains(key) && pending.exists: current =>
      current.key == key && current.requestId == requestId

  private def submit(game: Game, current: Pending, now: Long): Unit =
    if currentKey(game).contains(current.key) then
      if game.playedPlies < lila.core.fishnet.maxPlies then
        publish(FishnetMoveRequest(game, current.key, current.requestId))
        val attempts = current.attempts + 1
        lila.mon.fishnet.aiMove.request.increment()
        if attempts > 1 then lila.mon.fishnet.aiMove.retry.increment()
        pending = current
          .copy(
            attempts = attempts,
            nextAttemptAt = now + retryDelay(attempts).toMillis,
            lastAttemptAt = Some(now)
          )
          .some
      else
        pending = none
        tooManyPlies()

  private def currentKey(game: Game): Option[AiTurnKey] =
    if game.playableByAi then AiTurnKey.from(game) else none

private[round] object AiTurnCoordinator:

  private case class Pending(
      key: AiTurnKey,
      requestId: AiMoveRequestId,
      attempts: Int,
      nextAttemptAt: Long,
      lastAttemptAt: Option[Long]
  )

  private val forceDebounce = 1.second
  private val delayFactor = 0.011f
  private val defaultClock = Clock(Clock.LimitSeconds(300), Clock.IncrementSeconds(0))

  def retryDelay(attempts: Int): FiniteDuration =
    if attempts <= 1 then 5.seconds
    else if attempts == 2 then 10.seconds
    else 20.seconds

  def thinkDelay(game: Game): Option[FiniteDuration] =
    if !game.bothPlayersHaveMoved then 2.seconds.some
    else
      for
        pov <- game.aiPov
        clock = game.clock | defaultClock
        totalTime = clock.estimateTotalTime.centis
        if totalTime > 20 * 100
        delay = (game.effectiveClockRemaining(pov.color) | clock.remainingTime(pov.color)).centis
          .atMost(totalTime) * delayFactor
        accel = 1 - (game.ply.value - 20).atLeast(0).atMost(100) / 150f
        sleep = (delay * accel).atMost(500)
        if sleep > 25
        millis = sleep * 10
        randomized = millis + millis * (scalalib.ThreadLocalRandom.nextDouble() - 0.5)
        divided = randomized / (if game.ply > 9 then 1 else 2)
      yield divided.toInt.millis
