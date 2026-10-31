package lila.threeKingdoms

final case class ClockConfig(initialSeconds: Int = 900, moveSeconds: Int = 60):
  require(Set(420, 600, 900).contains(initialSeconds))
  require(Set(15, 30, 60).contains(moveSeconds))

/** Only the current player's clock runs. A move deadline never grants extra main time. */
final case class ClockState(remaining: Vector[Long], startedAt: Long, config: ClockConfig):
  require(remaining.size == 3 && remaining.forall(_ >= 0))
  def elapsed(now: Long): Long = (now - startedAt).max(0)
  def deadline(p: Position): Option[Long] = Option.unless(p.finished):
    startedAt + remaining(p.turn.ordinal).min(config.moveSeconds.toLong * 1000)
  def expired(p: Position, now: Long): Boolean = deadline(p).exists(_ <= now)
  def display(p: Position, now: Long): Vector[Long] =
    if p.finished then remaining
    else remaining.updated(p.turn.ordinal, (remaining(p.turn.ordinal) - elapsed(now)).max(0))
  def advance(before: Position, after: Position, now: Long): ClockState =
    // An off-turn resignation must not reset the current player's move deadline.
    if before.turn == after.turn && !after.finished && after.lastMove.isEmpty then this
    else copy(remaining = display(before, now), startedAt = now)

object ClockState:
  def start(config: ClockConfig, now: Long): ClockState =
    ClockState(Vector.fill(3)(config.initialSeconds.toLong * 1000), now, config)
