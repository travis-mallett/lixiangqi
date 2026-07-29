package lila.tree

import play.api.libs.json.*

/** Projects the canonical Xiangqi aggregate into the native Lichess analysis mainline shape.
  *
  * Rules state and WXF notation are persisted derivatives of coordinate moves, so consumers never reconstruct
  * the game with an international-chess rules implementation.
  */
object XiangqiTreeJson:

  private val idAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

  def apply(game: Game, analysis: Option[Analysis], options: ExportOptions): JsArray =
    val infos = analysis.toList.flatMap(_.infos).map(info => info.ply.value -> info).toMap
    val clocks = if options.clocks then game.bothClockStates.getOrElse(Vector.empty) else Vector.empty

    JsArray:
      game.xiangqi.states.zipWithIndex.map: (state, index) =>
        val info = infos.get(state.ply)
        Json
          .obj(
            "ply" -> state.ply,
            "fen" -> state.fen,
            "xiangqiLegalMoves" -> state.legalMoves.map(_.value),
            "xiangqiCheck" -> state.check
          )
          .add("id", Option.when(index > 0)(nodeId(index)))
          .add("uci", game.xiangqi.moves.lift(index - 1).map(_.value))
          .add("san", game.xiangqi.wxf.lift(index - 1))
          .add("sanZh", game.xiangqi.chineseWxf.lift(index - 1))
          .add(
            "eval",
            info.map: value =>
              Json
                .obj()
                .add("cp", value.cp.map(_.value))
                .add("mate", value.mate.map(_.value))
                .add("best", value.best)
          )
          .add("clock", clocks.lift(index - 1).map(_.centis))

  private def nodeId(index: Int): String =
    val base = idAlphabet.length
    s"${idAlphabet.charAt((index / base) % base)}${idAlphabet.charAt(index % base)}"
