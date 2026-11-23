package lila.round

import chess.{ Black, ByColor, Centis, Clock, MoveMetrics, Rated, Timestamp, Timestamper, White }
import java.time.Instant

import lila.core.game.{ MoveTimeLimit, Player, Source }
import lila.core.id.TourId
import lila.game.GameExt.{ finish, firstMoveDeadlineMillis }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

class TimedMoveTest extends munit.FunSuite:
  private class TestTime(var millis: Long) extends Timestamper:
    def now = Timestamp(millis)

  private def arena(time: TestTime): Game =
    val game = lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(
          Player(GamePlayerId("red1"), White, aiLevel = None),
          Player(GamePlayerId("blk1"), Black, aiLevel = None)
        ),
        rated = Rated.No,
        source = Source.Arena,
        pgnImport = None,
        clock = Some(Clock(Clock.LimitSeconds(300), Clock.IncrementSeconds(10)).copy(timestamper = time))
      )
      .start
      .sloppy
    game.copy(
      movedAt = Instant.ofEpochMilli(time.millis),
      metadata = game.metadata.copy(tournamentId = Some(TourId("testtour")))
    )

  private def play(g: Game, at: Long, metrics: MoveMetrics = MoveMetrics()): TimedMove =
    TimedMove(g, g.position.legalMoves.head, false, metrics, at).fold(fail(_), identity)

  private def accepted(result: TimedMove): Game = result match
    case TimedMove.Applied(progress, _, _) => progress.game
    case other => fail(s"Expected an accepted move, got $other")

  test("5+10 arena gives each player 25 seconds for their own first move"):
    val start = arena(TestTime(1000))
    val deadline = start.firstMoveDeadlineMillis.get
    assertEquals(deadline, 26000L)
    assertEquals(play(start, deadline), TimedMove.NoStart)
    assertEquals(play(start, deadline + 500), TimedMove.NoStart)
    val reply = accepted(play(start, deadline - 1))
    assertEquals(reply.turnColor, Black)
    assertEquals(reply.firstMoveDeadlineMillis, Some(reply.movedAt.toEpochMilli + 25000))
    assertEquals(play(reply, reply.firstMoveDeadlineMillis.get), TimedMove.NoStart)
    val running = accepted(play(reply, reply.firstMoveDeadlineMillis.get - 1))
    assertEquals(running.firstMoveDeadlineMillis, None)
    assert(running.clock.exists(_.isRunning))
    assertEquals(start.playedPlies.value, 0)

  test("bank and move limit use receipt time even when the round processes a move later"):
    val time = TestTime(10000)
    val initial = arena(time)
    val bank = initial.clock.get.setRemainingTime(White, Centis(100)).start
    val running = initial.copy(clock = Some(bank))
    time.millis += 5000
    val next = accepted(play(running, 10990))
    assertEquals(next.clock.get.remainingTime(White), Centis(1001))
    assertEquals(next.clock.get.timer, Some(time.now))
    time.millis += 100
    assertEquals(next.clock.get.remainingTime(Black), Centis(29990))
    assertEquals(play(running, 11000), TimedMove.Flagged)
    val longBank = running.copy(
      clock = Some(bank.setRemainingTime(White, Centis(30000))),
      moveTimeLimit = Some(MoveTimeLimit(1))
    )
    accepted(play(longBank, 10990))
    assertEquals(play(longBank, 11000), TimedMove.Flagged)

  test("bounded lag compensation can save a running clock but never extend the no-start deadline"):
    val time = TestTime(10000)
    val initial = arena(time)
    val metrics = MoveMetrics(clientLag = Some(Centis(10)))
    val running = initial.copy(clock = initial.clock.map(_.setRemainingTime(White, Centis(100)).start))
    accepted(play(running, 11050, metrics))
    assertEquals(play(running, 14000, metrics), TimedMove.Flagged)
    assertEquals(play(initial, initial.firstMoveDeadlineMillis.get, metrics), TimedMove.NoStart)

  test("checkmate counts when it beats the clock and loses at the deadline"):
    val time = TestTime(10000)
    val initial = arena(time)
    val position =
      XiangqiRules.initialGame(Some("4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1")).fold(fail(_), identity)
    val game = initial.copy(
      xiangqi = position,
      clock = initial.clock.map(_.setRemainingTime(White, Centis(100)).start)
    )
    def mate(at: Long) =
      TimedMove(game, Xiangqi.Uci.unsafe("a3e3"), false, MoveMetrics(), at).fold(fail(_), identity)
    time.millis += 6000
    assertEquals(accepted(mate(10990)).position.termination, Some("checkmate"))
    assertEquals(mate(11000), TimedMove.Flagged)

  test("the final bank stops at the first limit reached even if the flag check arrives later"):
    val time = TestTime(10000)
    val initial = arena(time)
    val running = initial.copy(clock = initial.clock.map(_.start), moveTimeLimit = Some(MoveTimeLimit(1)))
    time.millis += 6000
    def bank(g: Game) = g.clock.get.remainingTime(White)
    assertEquals(bank(running.finish(chess.Status.Outoftime, Some(Black))), Centis(29900))
    assertEquals(bank(running.finish(chess.Status.Draw, None, drawOnFlag = true)), Centis(29900))
    assertEquals(bank(running.finish(chess.Status.Resign, Some(Black))), Centis(29400))
    val shortBank = running.copy(clock = running.clock.map(_.setRemainingTime(White, Centis(50))))
    assertEquals(bank(shortBank.finish(chess.Status.Outoftime, Some(Black))), Centis(0))
