package lila.tree

import play.api.libs.json.*
import chess.format.Fen

object XiangqiTreeJson:
  def apply(game: Game, analysis: Option[Analysis], options: ExportOptions): JsObject =
    Node.writeJson(TreeBuilder(game, analysis, Fen.Full(game.xiangqi.initialFen), options, _ => ()))
