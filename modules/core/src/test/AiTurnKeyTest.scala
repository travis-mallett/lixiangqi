package lila.core.fishnet

import chess.{ ByColor, Clock, Color, Rated }

import lila.core.game.{ Game, Player, Source }
import lila.core.id.{ GameId, GamePlayerId }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

class AiTurnKeyTest extends munit.FunSuite:

  test("the key is deterministic and covers the complete move history"):
    val initial = game()
    val replayed = play(play(initial))

    assertEquals(AiTurnKey.from(initial), AiTurnKey.from(initial.copy()))
    assertEquals(
      AiTurnKey.from(initial).map(_.value),
      Some("7a1db703beeda4a3b9871eae7b6dd66025e95bbd0663b172d975bd02e1126d49")
    )
    assertNotEquals(AiTurnKey.from(initial), AiTurnKey.from(replayed))
    assertNotEquals(
      AiTurnKey.from(initial),
      AiTurnKey.from(
        initial.copy(
          xiangqi = initial.xiangqi.copy(ruleset = lila.xiangqi.adjudication.Ruleset.Unrestricted)
        )
      )
    )
    assertEquals(AiTurnKey.from(initial).map(_.value.length), Some(64))

  test("the effective worker level is part of the key"):
    val normalClock = Clock(Clock.Config(Clock.LimitSeconds(60), Clock.IncrementSeconds(0)))
    val fastClock = Clock(Clock.Config(Clock.LimitSeconds(30), Clock.IncrementSeconds(0)))
    val normal = game(level = 1).copy(clock = Some(normalClock))
    val fast = game(level = 1).copy(clock = Some(fastClock))

    assertEquals(AiTurnKey.effectiveLevel(normal, 1), 1)
    assertEquals(AiTurnKey.effectiveLevel(fast, 1), 3)
    assertEquals(AiTurnKey.from(fast), Some(AiTurnKey(fast, 3)))
    assertNotEquals(AiTurnKey.from(normal), AiTurnKey.from(fast))

  private def game(level: Int = 5): Game =
    lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(
          Player(GamePlayerId("red1"), Color.White, aiLevel = Some(level)),
          Player(GamePlayerId("black1"), Color.Black, aiLevel = None)
        ),
        rated = Rated.No,
        source = Source.Ai,
        pgnImport = None
      )
      .withId(GameId("aikey001"))
      .start

  private def play(game: Game): Game =
    val uci = game.position.legalMoves.headOption.getOrElse(fail("expected a legal move"))
    val move = XiangqiRules.move(game.xiangqi, uci).fold(fail(_), identity)
    val xiangqi = game.xiangqi.applyMove(move).fold(fail(_), identity)
    game.copy(xiangqi = xiangqi)
