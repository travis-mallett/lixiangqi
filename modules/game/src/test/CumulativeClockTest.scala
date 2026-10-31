package lila.game

import chess.{ Black, ByColor, Centis, Clock, MoveMetrics, Rated, Timestamper, White }

import lila.core.game.{ Player, Source }
import lila.core.id.GamePlayerId
import lila.game.GameExt.*
import lila.xiangqi.{ Jieqi, Xiangqi, XiangqiRules }

class CumulativeClockTest extends munit.FunSuite:
  for jieqi <- List(false, true); ai <- List(false, true); increment <- List(0, 2) do
    test(s"ordinary cumulative clock retains spent time: jieqi=$jieqi ai=$ai increment=$increment"):
      val time = FakeTimestamper()
      var game = lila.core.game
        .newGame(
          xiangqi = if jieqi then Jieqi.initial().toOption.get else Xiangqi.Game.initial,
          players = ByColor(
            Player(GamePlayerId("red1"), White, aiLevel = None),
            Player(GamePlayerId("blk1"), Black, aiLevel = Option.when(ai)(1))
          ),
          rated = Rated.No,
          source = if ai then Source.Ai else Source.Friend,
          pgnImport = None,
          clock =
            Some(Clock(Clock.LimitSeconds(60), Clock.IncrementSeconds(increment)).copy(timestamper = time))
        )
        .start
        .sloppy

      def play(): Unit =
        val move = XiangqiRules.move(game.xiangqi, game.position.legalMoves.head).toOption.get
        val next = game.xiangqi.applyMove(move).toOption.get
        val clock = game.clock.map(_.step(MoveMetrics()).value)
        game = game.applyMove(next, move, clock).game

      play()
      assert(!game.clock.get.isRunning)
      play()
      assert(game.clock.get.isRunning)
      time.millis += 25_000
      play()
      assertEquals(game.clock.get.remainingTime(White), Centis.ofSeconds(35 + increment))
      time.millis += 2_000
      play()
      assertEquals(game.clock.get.remainingTime(White), Centis.ofSeconds(35 + increment))
      time.millis += 20_000
      play()
      assertEquals(game.clock.get.remainingTime(White), Centis.ofSeconds(15 + 2 * increment))
      assertEquals(game.clockHistory.get.white.last, Centis.ofSeconds(15 + 2 * increment))
      play()
      time.millis += (16 + 2 * increment) * 1_000
      assert(game.outoftime(withGrace = false))
      val finished = game.finish(chess.Status.Resign, Some(Black))
      assert(finished.clock.get.remainingTime(White) < Centis.ofSeconds(1))
      assertEquals(finished.clock.get.remainingTime(Black), Centis.ofSeconds(58 + 2 * increment))

  private case class FakeTimestamper(var millis: Long = 0L) extends Timestamper:
    def now = chess.Timestamp(millis)
