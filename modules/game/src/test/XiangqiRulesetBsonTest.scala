package lila.game

import reactivemongo.api.bson.*
import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.adjudication.Ruleset

class XiangqiRulesetBsonTest extends munit.FunSuite:
  import BSONHandlers.xiangqiGameHandler

  test("ruleset and adjudication snapshots survive persistence"):
    val initial = Xiangqi.Game.initial
    val result = XiangqiRules.move(initial, Xiangqi.Uci.unsafe("b1c3")).toOption.get
    val game = initial.applyMove(result).toOption.get
    val bson = xiangqiGameHandler.writeTry(game).get
    val restored = xiangqiGameHandler.readDocument(bson).get
    assertEquals(restored, game)
    assertEquals(restored.state.adjudication.get.naturalPlies, 1)

  test("old records without a ruleset keep unrestricted semantics"):
    val current = xiangqiGameHandler.writeTry(Xiangqi.Game.initial).get
    val oldStates = current
      .getAsOpt[Vector[BSONDocument]]("states")
      .get
      .map(
        _ -- "adjudication" -- "termination" -- "variation" -- "captures" -- "reveal"
      )
    val bson = (current -- "ruleset" -- "states") ++ BSONDocument("states" -> oldStates)
    val restored = xiangqiGameHandler.readDocument(bson).get
    assertEquals(restored.ruleset, Ruleset.Unrestricted)
    assertEquals(restored.state.adjudication, None)
    assertEquals(restored.state.captures, Vector.empty)

  test("unknown rule versions fail rather than silently using the default"):
    val bson = (xiangqiGameHandler.writeTry(Xiangqi.Game.initial).get -- "ruleset") ++
      BSONDocument("ruleset" -> "wxf-future")
    assert(xiangqiGameHandler.readDocument(bson).isFailure)

  test("the private deal and public capture ledger survive a server restart"):
    val initial = lila.xiangqi.Jieqi.initial().toOption.get
    val capture = XiangqiRules.move(initial, Xiangqi.Uci.unsafe("b3b10")).toOption.get
    val game = initial.applyMove(capture).toOption.get
    val restored = xiangqiGameHandler.readDocument(xiangqiGameHandler.writeTry(game).get).get
    assertEquals(restored, game)
    assertEquals(restored.state.captures.head.role, None)
    assertEquals(
      lila.xiangqi.Jieqi.captures(restored, revealConcealed = true).head.role,
      Some(game.deal.get.at("b10").key)
    )

  test("analysis positions persist reveal outcomes and private captured knowledge without a deal"):
    val codec = lila.db.XiangqiBson.positionHandler
    val position = Xiangqi.Position(
      lila.xiangqi.Jieqi.startFen,
      Vector(Xiangqi.Uci.unsafe("b3b10")),
      Ruleset.Jieqi,
      Vector(Some("horse")),
      Map("b10" -> "chariot")
    )
    assertEquals(codec.readDocument(codec.writeTry(position).get).get, position)
    val old =
      BSONDocument("initialFen" -> Xiangqi.startFen, "moves" -> BSONArray(), "ruleset" -> "tiantian-v1")
    assertEquals(codec.readDocument(old).get, Xiangqi.Position(ruleset = Ruleset.Tiantian))

  test("Mini Xiangqi geometry, variant and history survive persistence and continued play"):
    val initial = lila.xiangqi.GameVariant.MiniXiangqi.initialGame(None, Ruleset.MiniXiangqi).toOption.get
    val result = XiangqiRules.move(initial, Xiangqi.Uci.unsafe("a2b2")).toOption.get
    val game = initial.applyMove(result).toOption.get
    val restored = xiangqiGameHandler.readDocument(xiangqiGameHandler.writeTry(game).get).get
    assertEquals(restored, game)
    assertEquals(restored.variant, lila.xiangqi.GameVariant.MiniXiangqi)
    assertEquals(restored.ruleset, Ruleset.MiniXiangqi)
    assert(XiangqiRules.move(restored, Xiangqi.Uci.unsafe("a6b6")).isRight)
