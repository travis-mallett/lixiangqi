package lila.game

import chess.{ ByColor, Centis, Color, Ply }
import play.api.libs.json.{ JsObject, Json }

import lila.core.game.Game
import lila.core.game.ClockHistory.bothClockStates
import lila.game.GameExt.clockMoveTimes

/** A validated, viewer-facing projection of the real-time clock history.
  *
  * `positions(0)` is the clock at the root position. Each following position is the state immediately after
  * the corresponding recorded move. `delays(n)` is the server-accounted time before moving from position `n`
  * to `n + 1`.
  */
final case class RecordedClockTimeline(
    startPly: Ply,
    positions: Vector[ByColor[Centis]],
    delays: Vector[Centis]
):
  def json: JsObject =
    Json.obj(
      "startPly" -> startPly.value,
      "positions" -> positions.map: position =>
        Json.obj(
          "white" -> position.white.centis,
          "black" -> position.black.centis
        ),
      "delays" -> delays.map(_.centis)
    )

object RecordedClockTimeline:

  def apply(game: Game): Option[RecordedClockTimeline] =
    val moveCount = game.xiangqi.moves.size
    for
      clock <- game.clock
      history <- game.clockHistory
      _ <- history(Color.White).headOption
      _ <- history(Color.Black).headOption
      clockStates = history.bothClockStates(game.startColor)
      delays <- game.clockMoveTimes
      if moveCount > 0 && clockStates.size >= moveCount && delays.size >= moveCount
    yield
      val initial: ByColor[Centis] = clock.players.map(_.limit)
      val positions = clockStates
        .take(moveCount)
        .zipWithIndex
        .scanLeft(initial):
          case (previous, (remaining, index)) =>
            val mover = if index % 2 == 0 then game.startColor else !game.startColor
            previous.update(mover, _ => remaining)
      RecordedClockTimeline(
        startPly = game.xiangqi.states.headOption.fold(game.startedAtPly)(state => Ply(state.ply)),
        positions = positions,
        delays = delays.take(moveCount)
      )
