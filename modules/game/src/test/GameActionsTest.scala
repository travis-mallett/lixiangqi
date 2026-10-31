package lila.game

import chess.{ Black, ByColor, Rated, White }

import lila.core.game.{ Player, Source }
import lila.core.id.GamePlayerId
import lila.game.GameExt.*
import lila.xiangqi.{ Jieqi, Xiangqi }

class GameActionsTest extends munit.FunSuite:
  for
    jieqi <- List(false, true)
    bot <- List(false, true)
  do
    test(s"shared game actions: jieqi=$jieqi bot=$bot"):
      val initial = if jieqi then Jieqi.initial().toOption.get else Xiangqi.Game.initial
      val base = lila.core.game
        .newGame(
          xiangqi = initial,
          players = ByColor(
            Player(GamePlayerId("red1"), White, aiLevel = None),
            Player(GamePlayerId("blk1"), Black, aiLevel = Option.when(bot)(1))
          ),
          rated = Rated.No,
          source = Source.Friend,
          pgnImport = None
        )
        .start
        .sloppy
      assert(!base.resignable)
      for ply <- List(2, 3, 13, 14, 15) do
        val game = base.copy(xiangqi = initial.copy(states = Vector(initial.state.copy(ply = ply))))
        assert(game.resignable)
        assertEquals(game.playerCanOfferDraw(White), !bot)
        if !bot then assert(game.playerCanOfferDraw(Black))
        val finished = game.copy(status = chess.Status.Resign)
        assert(!finished.resignable)
        assert(!finished.playerCanOfferDraw(White))
