package lila.game

import chess.{ ByColor, Clock, Rated, White, Black }

import lila.core.game.{ Player, Source }
import lila.core.id.GamePlayerId
import lila.game.GameExt.*
import lila.xiangqi.Xiangqi

class BerserkClockTest extends munit.FunSuite:
  test("tournament berserk produces an immediate clock snapshot and removes only that side's increment"):
    val base = lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(
          Player(GamePlayerId("red1"), White, aiLevel = None),
          Player(GamePlayerId("blk1"), Black, aiLevel = None)
        ),
        rated = Rated.No,
        source = Source.Api,
        pgnImport = None,
        clock = Some(Clock(Clock.Config(Clock.LimitSeconds(300), Clock.IncrementSeconds(2))))
      )
      .start
      .sloppy
    val game = base.copy(metadata = base.metadata.copy(tournamentId = Some(TourId("tour1234"))))
    val progress = game.goBerserk(White).get
    val clock = progress.game.clock.get
    assert(progress.game.whitePlayer.berserk)
    assert(!progress.game.blackPlayer.berserk)
    assertEquals(clock.incrementOf(White).millis, 0L)
    assertEquals(clock.incrementOf(Black).millis, 2000L)
    assert(clock.remainingTime(White).millis <= 150000)
    assert(clock.remainingTime(White).millis > 149000)
    assert(progress.events.exists(_.isInstanceOf[Event.Clock]))
    assert(progress.events.exists(_.isInstanceOf[Event.Berserk]))
    assertEquals(progress.game.goBerserk(White), None)
    assertEquals(base.goBerserk(White), None)
