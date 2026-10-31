package lila.round

import chess.{ ByColor, Color, Rated }
import play.api.libs.json.*

import lila.core.game.{ Player, Source }
import lila.core.id.{ GameId, GamePlayerId }
import lila.core.socket.SocketVersion
import lila.xiangqi.{ Jieqi, Xiangqi, XiangqiRules }

class JieqiCaptureEventTest extends munit.FunSuite:
  test("concealed capture events use the shared single-player wire audience"):
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
    for (color, flag) <- List(Color.White -> "w", Color.Black -> "b") do
      val event = lila.game.Event.PrivateCaptures(game, color)
      val wire = RoundSocket.Protocol.Out.tellVersion(RoomId("jieqi001"), SocketVersion(1), event)
      assert(wire.startsWith(s"r/ver jieqi001 1 $flag captures "), wire)
      val captures = event.data.as[JsArray].value
      assertEquals((captures.head \ "role").asOpt[String].isDefined, color.white)
