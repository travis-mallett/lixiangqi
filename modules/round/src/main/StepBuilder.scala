package lila.round

import play.api.libs.json.*

object StepBuilder:

  def apply(game: Game): JsArray =
    apply(game.xiangqi)

  private[round] def apply(game: lila.xiangqi.Xiangqi.Game): JsArray =
    JsArray:
      game.states.zipWithIndex.map: (state, index) =>
        Json.obj(
          "ply" -> state.ply,
          "uci" -> game.moves.lift(index - 1).map(_.value),
          "san" -> game.wxf.lift(index - 1),
          "sanZh" -> game.chineseWxf.lift(index - 1),
          "fen" -> state.fen,
          "check" -> state.check,
          "mate" -> (state.check && state.immediateEnd.ended &&
            state.gameResult.winner.isDefined &&
            state.termination.forall(_ == "checkmate"))
        )
