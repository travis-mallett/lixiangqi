package lila.game

import chess.{ ByColor, Color, Rated }
import lila.core.game.{ Player, Source }
import lila.core.id.{ GameId, GamePlayerId }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

class KidsBotPersistenceTest extends munit.FunSuite:
  test("a rewind persists assistance regardless of the client requesting it"):
    val game = lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(
          Player(GamePlayerId("red1"), Color.White, aiLevel = None),
          Player(GamePlayerId("blk1"), Color.Black, aiLevel = Some(1))
        ),
        rated = Rated.No,
        source = Source.Ai,
        pgnImport = None
      )
      .withId(GameId("kids0001"))
      .start
    val moved = XiangqiRules.move(game.xiangqi, Xiangqi.Uci.unsafe("b1c3")).toOption.get
    val position = game.xiangqi.applyMove(moved).toOption.get
    val kids = game.copy(
      xiangqi = position,
      metadata =
        game.metadata.copy(kidsBotProfile = Some("v1/dou-dou"), kidsBotReceipt = Some("guest/test:request"))
    )
    val rewound = Rewind(kids).toOption.get.game
    assert(rewound.metadata.kidsBotAssisted)
    assert(GameDiff(kids, rewound)._1.exists(_._1 == "kidsHelp"))
    assert(!Rewind(game.copy(xiangqi = position)).toOption.get.game.metadata.kidsBotAssisted)
