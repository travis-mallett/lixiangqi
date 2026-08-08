package lila.core.game

import chess.{ Black, ByColor, Centis, Clock, Rated, Timestamper, White }

import lila.core.id.GamePlayerId
import lila.xiangqi.{ Xiangqi, XiangqiRules }

class MoveTimeLimitTest extends munit.FunSuite:

  private val limit = MoveTimeLimit(
    seconds = 90,
    first = Some(MoveTimeLimit.FirstPhase(moves = 3, seconds = 30))
  )

  test("selects the opening limit independently for each player's first moves"):
    assertEquals(limit.limitForMove(1), 30)
    assertEquals(limit.limitForMove(3), 30)
    assertEquals(limit.limitForMove(4), 90)

  test("normalizes a redundant opening phase"):
    assertEquals(
      MoveTimeLimit(90, Some(MoveTimeLimit.FirstPhase(3, 90))).normalized,
      MoveTimeLimit(90)
    )

  test("rejects invalid limits at the domain boundary"):
    intercept[IllegalArgumentException](MoveTimeLimit(0))
    intercept[IllegalArgumentException](MoveTimeLimit(301))
    intercept[IllegalArgumentException](MoveTimeLimit.FirstPhase(0, 30))
    intercept[IllegalArgumentException](MoveTimeLimit.FirstPhase(3, 0))

  test("requires a real-time clock and a policy for paused deadlines"):
    intercept[IllegalArgumentException](baseNewGame(clock = None, moveTimeLimit = Some(limit)))
    intercept[IllegalArgumentException](
      baseNewGame(
        clock = Some(Clock(Clock.Config(Clock.LimitSeconds(15 * 60), Clock.IncrementSeconds(0)))),
        moveTimeLimit = None,
        moveTimePaused = true
      )
    )

  test("enforces the current move limit and compensated lag"):
    val timestamper = FakeTimestamper()
    val game = makeGame(plies = 5, timestamper)

    // After five plies, Black is playing their third move and still has the opening limit.
    assertEquals(game.turnColor, Black)
    assertEquals(game.playerMoves(Black), 2)

    timestamper.millis = 29_000
    assertEquals(game.moveTimeRemaining, Some(Centis.ofSeconds(1)))
    assert(!game.outoftime(withGrace = false))

    timestamper.millis = 31_000
    assert(game.outoftime(withGrace = false))
    assert(!game.moveTimeOutAfterCompensation(Some(Centis.ofSeconds(2))))
    assert(game.moveTimeOutAfterCompensation(Some(Centis.ofSeconds(1))))

  test("switches to the normal move limit after each player has moved three times"):
    val timestamper = FakeTimestamper()
    val game = makeGame(plies = 6, timestamper)

    // After six plies, White is playing their fourth move.
    assertEquals(game.turnColor, White)
    assertEquals(game.playerMoves(White), 3)

    timestamper.millis = 31_000
    assert(!game.outoftime(withGrace = false))
    timestamper.millis = 90_000
    assert(game.outoftime(withGrace = false))

  test("starts the bank and move deadline together on the opening move"):
    val timestamper = FakeTimestamper()
    val game = newGame(
      xiangqi = Xiangqi.Game.initial,
      players = ByColor(
        Player(GamePlayerId("wht1"), White, aiLevel = None),
        Player(GamePlayerId("blk1"), Black, aiLevel = None)
      ),
      rated = Rated.No,
      source = Source.Lobby,
      pgnImport = None,
      clock = Some(
        Clock(Clock.Config(Clock.LimitSeconds(15 * 60), Clock.IncrementSeconds(0)))
          .copy(timestamper = timestamper)
      ),
      moveTimeLimit = Some(limit)
    ).start.sloppy

    assert(game.clock.exists(_.isRunning))
    timestamper.millis = 12_000
    assertEquals(game.clock.map(_.remainingTime(White)), Some(Centis.ofSeconds(15 * 60 - 12)))
    assertEquals(game.moveTimeRemaining, Some(Centis.ofSeconds(18)))

    timestamper.millis = 31_000
    assert(game.outoftime(withGrace = false))
    assert(!game.moveTimeOutAfterCompensation(Some(Centis.ofSeconds(2))))
    assertEquals(game.moveTimeRemaining, Some(Centis(0)))

  test("does not start a scheduled move deadline before the clock starts"):
    val game = newGame(
      xiangqi = Xiangqi.Game.initial,
      players = ByColor(
        Player(GamePlayerId("wht1"), White, aiLevel = None),
        Player(GamePlayerId("blk1"), Black, aiLevel = None)
      ),
      rated = Rated.No,
      source = Source.Api,
      pgnImport = None,
      clock = Some(Clock(Clock.Config(Clock.LimitSeconds(15 * 60), Clock.IncrementSeconds(0)))),
      moveTimeLimit = Some(limit),
      moveTimePaused = true
    ).start.sloppy.copy(movedAt = java.time.Instant.now.minusSeconds(31))

    assert(game.clock.exists(!_.isRunning))
    assert(!game.outoftime(withGrace = false))
    assertEquals(game.moveTimeRemaining, None)

  private def makeGame(plies: Int, timestamper: FakeTimestamper): Game =
    val xiangqi = (0 until plies).foldLeft(Xiangqi.Game.initial): (game, _) =>
      val move = game.state.legalMoves.head
      XiangqiRules
        .move(game, move)
        .flatMap(game.applyMove)
        .fold(error => fail(error), identity)
    val clock = Clock(Clock.Config(Clock.LimitSeconds(15 * 60), Clock.IncrementSeconds(0)))
      .copy(timestamper = timestamper)
      .start
    newGame(
      xiangqi = xiangqi,
      players = ByColor(
        Player(GamePlayerId("wht1"), White, aiLevel = None),
        Player(GamePlayerId("blk1"), Black, aiLevel = None)
      ),
      rated = Rated.No,
      source = Source.Lobby,
      pgnImport = None,
      clock = Some(clock),
      moveTimeLimit = Some(limit)
    ).start.sloppy

  private def baseNewGame(
      clock: Option[Clock],
      moveTimeLimit: Option[MoveTimeLimit],
      moveTimePaused: Boolean = false
  ) =
    newGame(
      xiangqi = Xiangqi.Game.initial,
      players = ByColor(
        Player(GamePlayerId("wht1"), White, aiLevel = None),
        Player(GamePlayerId("blk1"), Black, aiLevel = None)
      ),
      rated = Rated.No,
      source = Source.Api,
      pgnImport = None,
      clock = clock,
      moveTimeLimit = moveTimeLimit,
      moveTimePaused = moveTimePaused
    )

  private case class FakeTimestamper(var millis: Long = 0L) extends Timestamper:
    def now = chess.Timestamp(millis)
