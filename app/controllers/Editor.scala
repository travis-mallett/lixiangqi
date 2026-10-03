package controllers

import chess.format.Fen
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
            .fold(editorUrlString(game.xiangqi.state.fen))(editorUrlString)

  private[controllers] def editorUrl(
      fen: Fen.Full
  ): String =
    editorUrlString(fen.value)

  private def editorUrlString(
      fen: String
  ): String =
    if fen == Xiangqi.startFen then routes.Editor.index.url
    else routes.Editor.load(fen.replace(' ', '_')).url
