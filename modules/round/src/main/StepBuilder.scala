package lila.round

import play.api.libs.json.*

object StepBuilder:

  def apply(game: Game): JsArray =
    JsArray:
      game.xiangqi.states.zipWithIndex.map: (state, index) =>
        Json.obj(
          "ply" -> state.ply,
          "uci" -> game.xiangqi.moves.lift(index - 1).map(_.value),
          "san" -> game.xiangqi.wxf.lift(index - 1),
          "sanZh" -> game.xiangqi.chineseWxf.lift(index - 1),
          "fen" -> state.fen,
          "check" -> state.check
        )
