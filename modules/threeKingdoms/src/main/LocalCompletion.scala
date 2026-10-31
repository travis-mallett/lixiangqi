package lila.threeKingdoms

/** Archive guest losses without hosting a surviving computer duel. */
object LocalCompletion:
  def game(
      id: GameId,
      guest: Kingdom,
      level: Int,
      config: ClockConfig,
      events: Vector[RecordedAction],
      now: Long,
      elapsed: Long = 0
  ): Either[String, KingdomGame] =
    val valid = level >= 1 && level <= 5 && elapsed >= 0 && elapsed <= config.initialSeconds.toLong * 1000 &&
      events.nonEmpty && events.size <= Rules.maxPlies &&
      events.forall(e =>
        e.at >= 0 && e.at <= now + 5 * 60 * 1000 && e.clocks.size == 3 &&
          e.clocks.forall(n => n >= 0 && n <= config.initialSeconds.toLong * 1000)
      ) &&
      events.map(_.at) == events.map(_.at).sorted
    for
      _ <- Either.cond(valid, (), "invalidRequest")
      position <- KingdomGame.replay(Position.initial, events)
      _ <- Either.cond(
        position.active.size == 2 && !position.active.contains(guest) && !position.finished,
        (),
        "invalidRequest"
      )
    yield KingdomGame(
      id,
      Kingdom.values.toVector.map(k =>
        if k == guest then Seat(None, None, None, guest = true)
        else Seat(None, Some(level), None)
      ),
      Position.initial,
      position,
      ClockState(events.last.clocks, now - elapsed, config),
      java.time.Instant.ofEpochMilli(events.head.at),
      java.time.Instant.ofEpochMilli(now),
      revision = events.size,
      events = events,
      source = "local-completion"
    ).finishComputerDuel(now)
