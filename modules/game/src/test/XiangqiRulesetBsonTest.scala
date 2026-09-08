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
    val oldStates = current.getAsOpt[Vector[BSONDocument]]("states").get.map(
      _ -- "adjudication" -- "termination" -- "variation"
    )
    val bson = (current -- "ruleset" -- "states") ++ BSONDocument("states" -> oldStates)
    val restored = xiangqiGameHandler.readDocument(bson).get
    assertEquals(restored.ruleset, Ruleset.Unrestricted)
    assertEquals(restored.state.adjudication, None)

  test("unknown rule versions fail rather than silently using the default"):
    val bson = (xiangqiGameHandler.writeTry(Xiangqi.Game.initial).get -- "ruleset") ++
      BSONDocument("ruleset" -> "wxf-future")
    assert(xiangqiGameHandler.readDocument(bson).isFailure)
