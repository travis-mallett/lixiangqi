package lila.core.game

import chess.{ ByColor, Color, Rated }
import lila.core.id.{ GameAnyId, GameId, GamePlayerId }
import lila.core.userId.UserId
import lila.xiangqi.Xiangqi

class PlayerAccessTest extends munit.FunSuite:
  private val red = Player(GamePlayerId("red1"), Color.white, None, userId = Some(UserId("alice")))
  private val black = Player(GamePlayerId("blk1"), Color.black, None)
  private val game = newGame(
    xiangqi = Xiangqi.Game.initial,
    players = ByColor(red, black),
    rated = Rated.No,
    source = Source.Lobby,
    pgnImport = None
  ).sloppy.copy(id = GameId("mobile01"))

  test("registered play requires the matching account even with a leaked full id"):
    assertEquals(
      Pov.forPlayer(game, GameAnyId("mobile01"), Some(UserId("alice"))).map(_.color),
      Some(Color.white)
    )
    assertEquals(Pov.forPlayer(game, game.fullIdOf(Color.white).anyId, None), None)
    assertEquals(Pov.forPlayer(game, game.fullIdOf(Color.white).anyId, Some(UserId("mallory"))), None)

  test("guest access requires that guest's full id and cannot authorize an AI"):
    assertEquals(Pov.forPlayer(game, GameAnyId("mobile01"), None), None)
    assertEquals(Pov.forPlayer(game, GameAnyId("mobile01xxxx"), None), None)
    assertEquals(Pov.forPlayer(game, game.fullIdOf(Color.black).anyId, None).map(_.color), Some(Color.black))
    val ai = game.copy(players = ByColor(red, black.copy(aiLevel = Some(1))))
    assertEquals(Pov.forPlayer(ai, ai.fullIdOf(Color.black).anyId, None), None)

  test("a capability is bound to its game"):
    assertEquals(Pov.forPlayer(game, GameAnyId("another1blk1"), None), None)
