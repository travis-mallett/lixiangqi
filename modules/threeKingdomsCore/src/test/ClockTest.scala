package lila.threeKingdoms

class ClockTest extends munit.FunSuite:
  import Kingdom.*

  test("only the current seat is charged; main time and move deadline are both enforced"):
    val p = Position.initial
    val clock = ClockState.start(ClockConfig(), 1000)
    assertEquals(clock.deadline(p), Some(61000L))
    assertEquals(clock.display(p, 11000), Vector(900000L, 900000L, 890000L))
    assert(!clock.expired(p, 60999))
    assert(clock.expired(p, 61000))
    val short = clock.copy(remaining = Vector(900000L, 900000L, 5000L))
    assertEquals(short.deadline(p), Some(6000L))
    assertEquals(short.display(p, 100000).last, 0L)

  test("off-turn withdrawal and appropriation never replenish the active player's clock"):
    val p = Position.initial
    val clock = ClockState.start(ClockConfig(), 1000)
    val withdrawn = Rules.withdraw(p, Wu).toOption.get.position
    assertEquals(clock.advance(p, withdrawn, 9000), clock)
    val moved = Rules.play(withdrawn, Rules.legalMoves(withdrawn).head).toOption.get.position
    val advanced = clock.advance(withdrawn, moved, 11000)
    assertEquals(advanced.remaining, Vector(900000L, 900000L, 890000L))
    assertEquals(advanced.startedAt, 11000L)
    assertEquals(advanced.deadline(moved), Some(71000L))

  test("ending the game stops clocks and charges only elapsed current-turn time"):
    val p = Position.initial
    val clock = ClockState.start(ClockConfig(), 1000)
    val end = Rules.agreeDraw(p).toOption.get
    val stopped = clock.advance(p, end, 9000)
    assertEquals(stopped.deadline(end), None)
    assertEquals(stopped.display(end, 9999999), Vector(900000L, 900000L, 892000L))

  test("a backward wall-clock adjustment never grants main time"):
    val clock = ClockState.start(ClockConfig(), 1000)
    assertEquals(clock.display(Position.initial, 0), clock.remaining)

  test("increment and opening limits apply independently to each player"):
    val p = Position.initial
    val config = ClockConfig(300, 30, Some(5), opening = Some(OpeningTime(1, 10)))
    val clock = ClockState.start(config, 1000)
    assertEquals(clock.deadline(p), Some(11000L))
    val next = Rules.play(p, Rules.legalMoves(p).head).toOption.get.position
    val advanced = clock.advance(p, next, 4000)
    assertEquals(advanced.remaining(p.turn.ordinal), 302000L)
    assertEquals(advanced.deadline(next), Some(14000L))
    assertEquals(advanced.deadline(p), Some(34000L))

  test("correspondence resets the turn deadline without charging a bank"):
    val p = Position.initial
    val clock = ClockState.start(ClockConfig(0, 0, days = Some(2)), 1000)
    assertEquals(clock.deadline(p), Some(172801000L))
    val next = Rules.play(p, Rules.legalMoves(p).head).toOption.get.position
    val advanced = clock.advance(p, next, 4000)
    assertEquals(advanced.deadline(next), Some(172804000L))
    assertEquals(advanced.remaining, Vector(0L, 0L, 0L))

  test("unlimited games do not expire"):
    val p = Position.initial
    val clock = ClockState.start(ClockConfig(0, 0), 1000)
    assertEquals(clock.deadline(p), None)
    assert(!clock.expired(p, Long.MaxValue))

  test("increment-only games use the shared three-second minimum starting bank"):
    val clock = ClockState.start(ClockConfig(0, 0, Some(1)), 1000)
    assertEquals(clock.deadline(Position.initial), Some(4000L))
