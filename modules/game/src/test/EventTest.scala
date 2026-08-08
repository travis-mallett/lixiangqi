package lila.game

import org.scalacheck.Prop.forAll
import play.api.libs.json.*

import lila.xiangqi.Xiangqi

class EventTest extends munit.ScalaCheckSuite:

  import Arbitraries.given
  import JsonView.given

  test("native Xiangqi move event contract"):
    forAll: (move: Event.Move) =>
      val data = move.data
      assertEquals(data.str("uci"), move.result.move.value.some)
      assertEquals(data.str("san"), move.result.notation.some)
      assertEquals(data.str("sanZh"), move.result.chineseNotation.some)
      assertEquals(data.str("fen"), move.result.fen.some)
      assertEquals(data.int("ply"), move.state.turns.value.some)
      assertEquals(data.boolean("check"), move.result.check.some)
      assertEquals(data.boolean("capture"), move.result.capture.some)
      assertEquals(
        data.obj("dests"),
        Event.PossibleMoves.json(move.result.legalMoves).asOpt[JsObject]
      )
      assertEquals(data.obj("clock"), move.clock.map(_.data))
      assertEquals(data.obj("status"), move.state.status.map(summon[OWrites[chess.Status]].writes))
      assertEquals(data.str("winner"), move.state.winner.map(_.name))

  test("possible moves preserve rank ten coordinates"):
    val moves = Vector("b3b10", "b3b4", "i10i9").map(Xiangqi.Uci.unsafe)
    assertEquals(
      Event.PossibleMoves.json(moves),
      Json.obj(
        "b3" -> Json.arr("b10", "b4"),
        "i10" -> Json.arr("i9")
      )
    )

  test("possible moves with empty vector"):
    assertEquals(Event.PossibleMoves.json(Vector.empty), JsNull)

  test("clock event includes the current move deadline"):
    val event = Event.Clock(
      white = chess.Centis.ofSeconds(900),
      black = chess.Centis.ofSeconds(900),
      moveTime = chess.Centis.ofSeconds(30).some
    )
    assertEquals(event.data.int("moveTime"), 30.some)

  test("redirect owner contract"):
    forAll: (event: Event.RedirectOwner) =>
      assertEquals(event.data.str("id"), event.id.value.some)
      assertEquals(event.data.str("url"), s"/${event.id}".some)
      assertEquals(event.data.obj("cookie"), event.cookie)
