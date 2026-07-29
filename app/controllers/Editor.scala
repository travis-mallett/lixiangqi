package controllers

import chess.format.Fen
import chess.variant.Variant
import lila.app.*
import lila.xiangqi.Xiangqi

final class Editor(env: Env) extends LilaController(env):

  def index = load("")

  def load(urlFen: String) = Open:
    val fen = lila.common.String
      .decodeUriPath(urlFen)
      .map(_.replace('_', ' ').trim)
      .filter(_.nonEmpty)
    Ok.page:
      views.boardEditor(fen)

  def data = Open:
    JsonOk(views.boardEditor.jsData())

  def game(id: GameId) = Open:
    Found(env.game.gameRepo.game(id)): game =>
      Redirect:
        if game.playable
        then routes.Round.watcher(game.id, Color.white).url
        else
          get("fen")
            .map(_.trim)
            .filter(_.nonEmpty)
            .fold(editorUrlString(game.xiangqi.state.fen, game.variant))(editorUrlString(_, game.variant))

  private[controllers] def editorUrl(
      fen: Fen.Full,
      variant: Variant
  ): String =
    editorUrlString(fen.value, variant)

  private def editorUrlString(
      fen: String,
      variant: Variant
  ): String =
    if fen == Xiangqi.startFen && variant.standard then routes.Editor.index.url
    else
      val params = if variant.exotic then s"?variant=${variant.key}" else ""
      routes.Editor.load(fen.replace(' ', '_')).url + params
