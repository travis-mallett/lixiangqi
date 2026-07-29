package lila.puzzle

import chess.Ply
import play.api.libs.json.*
import play.api.libs.ws.DefaultBodyReadables.*
import play.api.libs.ws.JsonBodyWritables.*
import play.api.libs.ws.StandaloneWSClient

import lila.common.url.queryString
import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.XiangqiJson.given

/** Resolves puzzle games that live outside Lila's game repository.
  *
  * The puzzle module only knows about the catalog boundary. Individual game collections remain independently
  * owned by the explorer service.
  */
final private class SourceGameJson(endpoint: Url, ws: StandaloneWSClient)(using Executor):

  def apply(source: Puzzle.GameRef.Catalog, plies: Ply, bc: Boolean): Fu[JsObject] =
    ws.url(s"$endpoint/games/game")
      .post(Json.obj("id" -> source.id, "database" -> source.database))
      .flatMap: response =>
        if response.status == 200 then
          Json
            .parse(response.body[String])
            .validate[JsObject]
            .fold(
              errors => fufail(s"Invalid catalog game ${source.database}/${source.id}: $errors"),
              game => fuccess(render(source, game, plies, bc))
            )
        else
          fufail(
            s"Missing catalog puzzle game ${source.database}/${source.id}: HTTP ${response.status}"
          )

  private def render(
      source: Puzzle.GameRef.Catalog,
      game: JsObject,
      plies: Ply,
      bc: Boolean
  ): JsObject =
    val moveCount = plies.value + 1
    val moves = (game \ "moves").as[Vector[Xiangqi.Uci]].take(moveCount)
    val notations = (game \ "notations").as[Vector[String]].take(moveCount)
    val chineseNotations =
      XiangqiRules
        .game(Xiangqi.Position(initialFen = Xiangqi.startFen, moves = moves))
        .map(_.chineseWxf)
        .getOrElse(Vector.empty)
    val event = (game \ "event").asOpt[String].filter(_.nonEmpty)
    val sourceName =
      (game \ "sources")
        .asOpt[Vector[JsObject]]
        .flatMap(_.headOption)
        .flatMap: sourceJson =>
          (sourceJson \ "name").asOpt[String].filter(_.nonEmpty)
    val gameName = event.orElse(sourceName).getOrElse("Games database")
    val url = s"/analysis?${queryString(Map("game" -> source.id, "database" -> source.database))}"
    val base = Json
      .obj(
        "id" -> source.id,
        "url" -> url,
        "perf" -> Json.obj("key" -> "xiangqi", "name" -> gameName),
        "rated" -> false,
        "players" -> Json.arr(
          player(game \ "red", "white"),
          player(game \ "black", "black")
        ),
        "pgn" -> notations.mkString(" "),
        "initialFen" -> Xiangqi.startFen,
        "moves" -> moves,
        "notations" -> notations,
        "notationsZh" -> chineseNotations
      )
      .add("event", event)
      .add("sourceUrl", (game \ "sourceUrl").asOpt[String].filter(_.nonEmpty))

    if bc then
      base.add(
        "treeParts",
        XiangqiRules
          .position(Xiangqi.Position(initialFen = Xiangqi.startFen, moves = moves))
          .toOption
          .map: position =>
            Json
              .obj("fen" -> position.fen, "ply" -> position.ply)
              .add("san", notations.lastOption)
              .add("sanZh", chineseNotations.lastOption)
              .add("uci", moves.lastOption.map(_.value))
      )
    else base

  private def player(value: JsLookupResult, color: String): JsObject =
    val player = value.as[JsObject]
    Json
      .obj(
        "name" -> (player \ "name").as[String],
        "color" -> color
      )
      .add("rating", (player \ "rating").asOpt[Int])
