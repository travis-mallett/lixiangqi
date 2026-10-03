package lila.study

import chess.format.Fen
import lila.tree.{ Root, TreeBuilder, ExportOptions }

object GameToRoot:
  def apply(game: Game, initialFen: Option[Fen.Full], withClocks: Boolean): Root =
    TreeBuilder(
      game,
      None,
      initialFen.getOrElse(Fen.Full(game.xiangqi.initialFen)),
      ExportOptions.default.copy(clocks = withClocks),
      message => logger.warn(message)
    )
