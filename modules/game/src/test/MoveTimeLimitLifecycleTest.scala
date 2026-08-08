package lila.game

import chess.{ ByColor, Clock, MoveMetrics, Rated, Timestamper, White }

import lila.core.game.{ MoveTimeLimit, Player, Source }
import lila.core.id.GamePlayerId
import lila.game.GameExt.{ applyMove, startClock }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

class MoveTimeLimitLifecycleTest extends munit.FunSuite:

  test("starting a regular game starts its bank and move deadline together"):
    val game = lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(
          Player(GamePlayerId("wht1"), White, aiLevel = None),
          Player(GamePlayerId("blk1"), chess.Black, aiLevel = None)
        ),
        rated = Rated.No,
        source = Source.Lobby,
        pgnImport = None,
        clock = Some(Clock(Clock.Config(Clock.LimitSeconds(15 * 60), Clock.IncrementSeconds(0)))),
        moveTimeLimit = Some(MoveTimeLimit(90))
      )
      .start
      .sloppy

    assert(game.clock.exists(_.isRunning))
    assert(game.moveTimeRemaining.isDefined)

  test("starting a scheduled clock activates its move deadline"):
    val game = lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(
          Player(GamePlayerId("wht1"), White, aiLevel = None),
          Player(GamePlayerId("blk1"), chess.Black, aiLevel = None)
        ),
        rated = Rated.No,
        source = Source.Api,
        pgnImport = None,
        clock = Some(Clock(Clock.Config(Clock.LimitSeconds(15 * 60), Clock.IncrementSeconds(0)))),
        moveTimeLimit = Some(MoveTimeLimit(90)),
        moveTimePaused = true
      )
      .start
      .sloppy

    assert(game.clock.exists(!_.isRunning))
    assertEquals(game.moveTimeRemaining, None)

    val started = game.startClock.get.game

    assert(!started.moveTimePaused)
    assert(started.clock.exists(_.isRunning))
    assert(started.moveTimeRemaining.isDefined)

  test("every move publishes the next player's renewed phase deadline"):
    val timestamper = FakeTimestamper()
    var game = lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(
          Player(GamePlayerId("wht1"), White, aiLevel = None),
          Player(GamePlayerId("blk1"), chess.Black, aiLevel = None)
        ),
        rated = Rated.No,
        source = Source.Lobby,
        pgnImport = None,
        clock = Some(
          Clock(Clock.Config(Clock.LimitSeconds(15 * 60), Clock.IncrementSeconds(0)))
            .copy(timestamper = timestamper)
        ),
        moveTimeLimit = Some(
          MoveTimeLimit(90, Some(MoveTimeLimit.FirstPhase(moves = 3, seconds = 30)))
        )
      )
      .start
      .sloppy

    Vector(30, 30, 30, 30, 30, 90).foreach: expectedSeconds =>
      timestamper.millis += 1_000
      val uci = game.position.legalMoves.head
      val move = XiangqiRules.move(game.xiangqi, uci).fold(error => fail(error), identity)
      val next = game.xiangqi.applyMove(move).fold(error => fail(error), identity)
      val steppedClock = game.clock.map(_.step(MoveMetrics()).value)
      val progress = game.applyMove(next, move, steppedClock)
      val publishedDeadline = progress.events.collectFirst:
        case Event.Move(_, _, Some(clock: Event.Clock)) => clock.moveTime

      assertEquals(publishedDeadline.flatten, Some(chess.Centis.ofSeconds(expectedSeconds)))
      game = progress.game

  private case class FakeTimestamper(var millis: Long = 0L) extends Timestamper:
    def now = chess.Timestamp(millis)
