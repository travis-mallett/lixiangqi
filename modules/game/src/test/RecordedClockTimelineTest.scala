package lila.game

import chess.{ ByColor, Clock, MoveMetrics, Rated, Timestamper, White }

import lila.core.game.{ Player, Source }
import lila.core.id.GamePlayerId
import lila.game.GameExt.{ applyMove, clockMoveTimes, startClock }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

class RecordedClockTimelineTest extends munit.FunSuite:

  test("requires a native real-time clock history"):
    val game = newGame(clock = None).sloppy
    assertEquals(RecordedClockTimeline(game), None)

  test("aligns authoritative clock positions and strict move delays"):
    val timestamper = FakeTimestamper()
    var game = newGame(
      Some(
        Clock(Clock.Config(Clock.LimitSeconds(300), Clock.IncrementSeconds(0)))
          .copy(timestamper = timestamper)
      )
    ).start.sloppy.startClock.getOrElse(fail("expected the clock to start")).game

    (1 to 4).foreach: _ =>
      timestamper.millis += 1_000
      val uci = game.position.legalMoves.head
      val move = XiangqiRules.move(game.xiangqi, uci).fold(error => fail(error), identity)
      val next = game.xiangqi.applyMove(move).fold(error => fail(error), identity)
      val steppedClock = game.clock.map(_.step(MoveMetrics(clientLag = Some(chess.Centis(0)))).value)
      game = game.applyMove(next, move, steppedClock).game

    val timeline = RecordedClockTimeline(game).getOrElse(fail("expected a recorded clock timeline"))
    assertEquals(timeline.positions.size, game.xiangqi.moves.size + 1)
    assertEquals(timeline.delays.size, game.xiangqi.moves.size)
    assertEquals(
      timeline.positions.head,
      ByColor.fill(chess.Centis.ofSeconds(300))
    )
    assertEquals(timeline.delays, game.clockMoveTimes.getOrElse(fail("expected strict clock delays")))
    assertEquals(timeline.delays.take(2), Vector(chess.Centis(0), chess.Centis(0)))
    assert(timeline.delays.drop(2).forall(_ == chess.Centis.ofSeconds(1)))

  private def newGame(clock: Option[Clock]) =
    lila.core.game.newGame(
      xiangqi = Xiangqi.Game.initial,
      players = ByColor(
        Player(GamePlayerId("wht1"), White, aiLevel = None),
        Player(GamePlayerId("blk1"), chess.Black, aiLevel = None)
      ),
      rated = Rated.No,
      source = Source.Lobby,
      pgnImport = None,
      clock = clock
    )

  private case class FakeTimestamper(var millis: Long = 0L) extends Timestamper:
    def now = chess.Timestamp(millis)
