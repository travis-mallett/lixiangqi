package lila.threeKingdoms

final case class OpeningTime(moves: Int, seconds: Int):
  require(moves >= 1 && moves <= 20)
  require(seconds >= 1 && seconds <= 300)

final case class ClockConfig(
    initialSeconds: Int = 900,
    moveSeconds: Int = 60,
    incrementSeconds: Option[Int] = None,
    days: Option[Int] = None,
    opening: Option[OpeningTime] = None
):
  val increment = incrementSeconds.getOrElse(0)
  def realTime: Boolean = initialSeconds > 0 || increment > 0
  def timeMode: String =
    if realTime then "realTime" else if days.isDefined then "correspondence" else "unlimited"
  require(initialSeconds >= 0 && initialSeconds <= 10800)
  require(increment >= 0 && increment <= 180)
  require(moveSeconds >= 0 && moveSeconds <= 300)
  require(days.forall(Set(1, 2, 3, 5, 7, 10, 14).contains))
  require(if realTime then days.isEmpty else moveSeconds == 0)
  require(opening.isEmpty || moveSeconds > 0)

  def initialMillis: Long =
    (if realTime && initialSeconds == 0 then increment.max(3) else initialSeconds).toLong * 1000

/** Only the current player's clock runs. A move deadline never grants extra main time. */
final case class ClockState(
    remaining: Vector[Long],
    startedAt: Long,
    config: ClockConfig,
    openingMoves: Option[Vector[Int]] = None
):
  require(remaining.size == 3 && remaining.forall(_ >= 0))
  def elapsed(now: Long): Long = (now - startedAt).max(0)
  def deadline(p: Position): Option[Long] =
    if p.finished then None
    else if config.realTime then
      val seat = p.turn.ordinal
      val limit = config.opening
        .filter(first => openingMoves.exists(_(seat) < first.moves))
        .fold(config.moveSeconds)(_.seconds)
      Some(startedAt + (if limit == 0 then remaining(seat) else remaining(seat).min(limit.toLong * 1000)))
    else config.days.map(days => startedAt + days.toLong * 86400000)
  def expired(p: Position, now: Long): Boolean = deadline(p).exists(_ <= now)
  def display(p: Position, now: Long): Vector[Long] =
    if p.finished || !config.realTime then remaining
    else remaining.updated(p.turn.ordinal, (remaining(p.turn.ordinal) - elapsed(now)).max(0))
  def advance(before: Position, after: Position, now: Long): ClockState =
    // An off-turn resignation must not reset the current player's deadline.
    if before.turn == after.turn && !after.finished && after.lastMove.isEmpty then this
    else
      val seat = before.turn.ordinal
      val balances = display(before, now)
      val played = after.ply > before.ply && after.lastMove.isDefined
      copy(
        remaining =
          if played then balances.updated(seat, balances(seat) + config.increment.toLong * 1000)
          else balances,
        startedAt = now,
        openingMoves =
          openingMoves.map(counts => if played then counts.updated(seat, counts(seat) + 1) else counts)
      )

object ClockState:
  def start(config: ClockConfig, now: Long): ClockState =
    ClockState(Vector.fill(3)(config.initialMillis), now, config, config.opening.map(_ => Vector.fill(3)(0)))
