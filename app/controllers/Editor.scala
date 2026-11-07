package controllers

import chess.format.Fen
import play.api.libs.json.Json
import lila.app.*
import lila.xiangqi.{ GameVariant, Xiangqi, XiangqiRules }

final class Editor(env: Env) extends LilaController(env):

  def index = load("")

  def load(urlFen: String) = Open:
    val fen = lila.common.String
      .decodeUriPath(urlFen)
      .map(_.replace('_', ' ').trim)
      .filter(_.nonEmpty)
      .orElse(get("fen").map(_.replace('_', ' ').trim).filter(_.nonEmpty))
    val variant = get("variant")
      .flatMap(GameVariant.fromKey(_).toOption)
      .getOrElse:
        if fen.exists(_.startsWith("TK1;")) then GameVariant.ThreeKingdoms
        else fen.flatMap(Xiangqi.Fen.board).fold(GameVariant.Xiangqi)(_.variant)
    val orientation = get("color").filter(Set("red", "black", "green"))
    Ok.page:
      views.boardEditor(fen, orientation, variant)

  def data = Open:
    JsonOk(views.boardEditor.jsData())

  def validate(variant: String) = AnonBodyOf(parse.json(12000)): body =>
    val result = for
      selected <- GameVariant.fromKey(variant)
      fen <- (body \ "fen").asOpt[String].toRight("Missing position")
      _ <- XiangqiRules.validateEditorPosition(fen, selected)
      state <- XiangqiRules.position(Xiangqi.Position(initialFen = fen))
    yield Json.obj(
      "fen" -> state.fen,
      "playable" -> (state.gameResult == Xiangqi.Result.Ongoing && state.legalMoves.nonEmpty)
    )
    fuccess(result.fold(error => BadRequest(jsonError(error)), JsonOk(_)))

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
