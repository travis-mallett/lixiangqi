package lila.game

import chess.*
import org.scalacheck.{ Arbitrary, Gen }
import play.api.libs.json.Json

import lila.xiangqi.Xiangqi

object Arbitraries:

  // TODO move somewhere
  given [S, T](using SameRuntime[S, T], Arbitrary[S]): Arbitrary[T] = Arbitrary:
    Arbitrary.arbitrary[S].map(summon[SameRuntime[S, T]].apply)

  given Arbitrary[Event.RedirectOwner] = Arbitrary:
    for
      color <- Gen.oneOf(Color.all)
      id <- Arbitrary.arbitrary[GameFullId]
      cookie <- Arbitrary.arbitrary[Option[Boolean]]
    yield Event.RedirectOwner(color, id, cookie.map(value => Json.obj("value" -> value)))

  given Arbitrary[Status] = Arbitrary(Gen.oneOf(Status.all))

  given Arbitrary[Event.State] = Arbitrary:
    for
      turns <- Arbitrary.arbitrary[Ply]
      status <- Gen.option(Arbitrary.arbitrary[Status])
      winner <- Gen.option(Gen.oneOf(Color.all))
      whiteOffersDraw <- Arbitrary.arbitrary[Boolean]
      blackOffersDraw <- Arbitrary.arbitrary[Boolean]
    yield Event.State(turns, status, winner, whiteOffersDraw, blackOffersDraw)

  given Arbitrary[Event.ClockEvent] = Arbitrary:
    for
      whiteTime <- Arbitrary.arbitrary[Centis]
      blackTime <- Arbitrary.arbitrary[Centis]
      nextLag <- Arbitrary.arbitrary[Option[Centis]]
    yield Event.Clock(whiteTime, blackTime, nextLag)

  given Arbitrary[Event.Move] = Arbitrary:
    for
      move <- Gen.oneOf("a1a2", "i10i9", "b3b10", "e1e2").map(Xiangqi.Uci.unsafe)
      notation <- Gen.oneOf("R9+1", "R1+1", "C8+7", "K5+1")
      capture <- Arbitrary.arbitrary[Boolean]
      check <- Arbitrary.arbitrary[Boolean]
      state <- Arbitrary.arbitrary[Event.State]
      clock <- Gen.option(Arbitrary.arbitrary[Event.ClockEvent])
      side = if state.turns.turn.white then Xiangqi.Side.Red else Xiangqi.Side.Black
      position = Xiangqi.State(
        variant = "xiangqi",
        fen = Xiangqi.startFen,
        ply = state.turns.value,
        turn = side,
        legalMoves = Vector("a1a2", "b3b10").map(Xiangqi.Uci.unsafe),
        check = check,
        insufficientMaterial = false,
        gameResult = Xiangqi.Result.Ongoing,
        immediateEnd = Xiangqi.Ending(ended = false, result = 0),
        optionalEnd = Xiangqi.Ending(ended = false, result = 0)
      )
      result = Xiangqi.MoveResult(
        move = move,
        notation = notation,
        chineseNotation = notation,
        capture = capture,
        checkmate = false,
        variant = position.variant,
        fen = position.fen,
        ply = position.ply,
        turn = position.turn,
        legalMoves = position.legalMoves,
        check = position.check,
        insufficientMaterial = position.insufficientMaterial,
        gameResult = position.gameResult,
        immediateEnd = position.immediateEnd,
        optionalEnd = position.optionalEnd
      )
    yield Event.Move(result, state, clock)
