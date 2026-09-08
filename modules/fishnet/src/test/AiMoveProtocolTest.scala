package lila.fishnet

import chess.Clock
import chess.format.Fen
import chess.variant.Standard
import play.api.libs.json.Json

import lila.core.fishnet.{ AiMoveRequestId, AiTurnKey }
import lila.xiangqi.Xiangqi

class AiMoveProtocolTest extends munit.FunSuite:

  test("writes the complete versioned move request"):
    val work = Work.Move(
      _id = Work.Id("request12345"),
      game = Work.Game(
        id = "abcd1234",
        initialFen = Some[Fen.Full](Fen.Full(Xiangqi.startFen)),
        studyId = None,
        variant = Standard,
        moves = "a4a5 a7a6"
      ),
      level = 5,
      clock = Work.Clock(10_000, 9_000, Clock.IncrementSeconds(2)).some,
      turnKey = AiTurnKey("0" * 64),
      ruleset = lila.xiangqi.adjudication.Ruleset.Tiantian,
      legalMoves = Vector(Xiangqi.Uci.unsafe("b1c3"))
    )

    val json = Json.parse(AiMoveProtocol.write(work))
    assertEquals((json \ "version").as[Int], 2)
    assertEquals((json \ "requestId").as[String], "request12345")
    assertEquals((json \ "position" \ "moves").as[Vector[String]], Vector("a4a5", "a7a6"))
    assertEquals((json \ "clock" \ "inc").as[Int], 2)
    assertEquals((json \ "position" \ "ruleset").as[String], "tiantian-v1")
    assertEquals((json \ "position" \ "legalMoves").as[Vector[String]], Vector("b1c3"))

  test("reads a move result with its correlation identity"):
    val result = AiMoveProtocol.read:
      Json.stringify:
        Json.obj(
          "version" -> 2,
          "type" -> "move",
          "gameId" -> "abcd1234",
          "requestId" -> "request12345",
          "turnKey" -> ("a" * 64),
          "move" -> "a1a2"
        )

    assertEquals(
      result,
      Right(
        AiMoveProtocol.Result.Move(
          GameId("abcd1234"),
          AiMoveRequestId("request12345"),
          AiTurnKey("a" * 64),
          Xiangqi.Uci.unsafe("a1a2")
        )
      )
    )

  test("rejects malformed or unsupported results"):
    assert(AiMoveProtocol.read("not-json").isLeft)
    assert(AiMoveProtocol.read("""{"version":1,"type":"workerReady"}""").isLeft)
    assert(
      AiMoveProtocol
        .read("""{"version":2,"type":"move","gameId":"abcd1234"}""")
        .isLeft
    )
