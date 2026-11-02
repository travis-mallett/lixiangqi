package lila.round

import chess.{ ByColor, Color, Rated, Status }
import play.api.libs.json.*

import lila.core.game.{ Player, Source }
import lila.core.id.{ GameId, GamePlayerId }
import lila.xiangqi.{ Jieqi, Xiangqi, XiangqiRules }

class JieqiCaptureEventTest extends munit.FunSuite:
  test("live capture payloads hide identities; completed games reveal them for every viewer"):
    val initial = Jieqi.initial().toOption.get
    val moved = XiangqiRules.move(initial, Xiangqi.Uci.unsafe("b3b10")).toOption.get
    val game = lila.core.game
      .newGame(
        xiangqi = initial.applyMove(moved).toOption.get,
        players = ByColor(
          Player(GamePlayerId("red1"), Color.White, aiLevel = None),
          Player(GamePlayerId("blk1"), Color.Black, aiLevel = None)
        ),
        rated = Rated.No,
        source = Source.Friend,
        pgnImport = None
      )
      .withId(GameId("jieqi001"))
    assertEquals(game.visibleCaptures.head.role, None)
    assertEquals(game.visibleStates.last.captures.head.role, None)
    val event = lila.game.Event.Move(
      moved,
      lila.game.Event.State(chess.Ply(1), None, None, false, false),
      None
    )
    assertEquals(((event.data \ "captures")(0) \ "role").asOpt[String], None)
    for status <- List(Status.Resign, Status.Outoftime, Status.Draw, Status.Aborted) do
      val finished = game.copy(status = status)
      val expected = Some(initial.deal.get.at("b10").key)
      assertEquals(finished.visibleCaptures.head.role, expected)
      assert(finished.visibleCaptures.head.concealed)
      assertEquals(finished.visibleStates.head.captures, Vector.empty)
      assertEquals(finished.visibleStates.last.captures.head.role, expected)
      val ended = lila.game.Event.EndData(finished, None)
      assertEquals(((ended.data \ "captures")(0) \ "role").asOpt[String], expected)
      assertEquals(((StepBuilder(finished).value.last \ "captures")(0) \ "role").asOpt[String], expected)
