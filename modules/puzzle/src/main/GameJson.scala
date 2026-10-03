package lila.puzzle

import chess.Ply
import play.api.libs.json.*

import lila.common.Json.given
import lila.common.url.queryString
import lila.core.LightUser
import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.XiangqiJson.given

final private class GameJson(
    cacheApi: lila.memo.CacheApi,
    lightUserApi: lila.core.user.LightUserApi
)(using Executor, lila.core.i18n.Translator):

  given play.api.i18n.Lang = lila.core.i18n.defaultLang

  private case class Key(id: GameId, source: Puzzle.SourceSnapshot, ply: Ply, bc: Boolean)

  private val snapshotCache = cacheApi[Key, JsObject](4096, "puzzle.sourceSnapshot"):
    _.expireAfterAccess(5.minutes).maximumSize(4096).buildAsyncFuture(generateSnapshot)

  def apply(puzzle: Puzzle, bc: Boolean): Fu[JsObject] =
    lightUserApi
      .preloadMany(puzzle.sourceSnapshot.players.flatMap(_.userId))
      .flatMap: _ =>
        snapshotCache
          .get(Key(puzzle.gameId, puzzle.sourceSnapshot, puzzle.initialPly, bc))
          .map: json =>
            val url = puzzle.gameSource.map:
              case Puzzle.GameSource.Catalog(database) =>
                s"/analysis?${queryString(Map("game" -> puzzle.gameId.value, "database" -> database))}"
            (json ++ Json.obj("players" -> JsArray(puzzle.sourceSnapshot.players.map(playersJson))))
              .add("url", url)

  def noCache(game: Game, plies: Ply): Fu[JsObject] =
    lightUserApi.preloadMany(game.userIds).inject(generate(game, plies))

  def noCacheBc(game: Game, plies: Ply): Fu[JsObject] =
    lightUserApi.preloadMany(game.userIds).inject(generateBc(game, plies))

  private def generateSnapshot(key: Key): Fu[JsObject] =
    val snapshot = key.source
    XiangqiRules.game(
      Xiangqi.Position(
        initialFen = snapshot.initialFen,
        moves = snapshot.moves.take(
          (key.ply.value - XiangqiRules
            .position(Xiangqi.Position(initialFen = snapshot.initialFen))
            .fold(_ => 0, _.ply) + 1).max(0)
        )
      )
    ) match
      case Left(error) => fufail(s"Invalid puzzle source snapshot ${key.id}: $error")
      case Right(game) =>
        fuccess:
          val sourceInitialPly = game.states.head.ply
          val moveCount = (key.ply.value - sourceInitialPly + 1).max(0)
          val moves = snapshot.moves.take(moveCount)
          val notations = game.wxf.take(moveCount)
          val chinese = game.chineseWxf.take(moveCount)
          val base = Json
            .obj(
              "id" -> key.id,
              "perf" -> Json.obj(
                "key" -> snapshot.perf.getOrElse("xiangqi"),
                "name" -> snapshot.name.getOrElse("Xiangqi")
              ),
              "rated" -> snapshot.rated.getOrElse(false),
              "pgn" -> notations.mkString(" "),
              "initialFen" -> snapshot.initialFen,
              "moves" -> moves.map(_.value),
              "states" -> game.states.take(moveCount + 1),
              "ruleset" -> game.ruleset,
              "notations" -> notations,
              "notationsZh" -> chinese
            )
            .add("event", snapshot.event)
            .add("sourceUrl", snapshot.sourceUrl)
          if key.bc then base.add("tree", Some(treeJson(game, moveCount))) else base

  private def playersJson(player: Puzzle.SourcePlayer): JsObject =
    val identity = player.userId.fold(Json.obj("name" -> player.name.getOrElse("Anonymous")))(id =>
      Json.toJsObject(lightUserApi.syncFallback(id))
    )
    val color = player.color match
      case "red" => "white"
      case "black" => "black"
      case other => other
    identity ++ Json.obj("color" -> color).add("rating", player.rating)

  private def generate(game: Game, plies: Ply): JsObject =
    val moveCount = moveCountFrom(game, plies)
    Json
      .obj(
        "id" -> game.id,
        "perf" -> perfJson(game),
        "rated" -> game.rated,
        "players" -> playersJson(game),
        "pgn" -> game.xiangqi.wxf.take(moveCount).mkString(" "),
        "initialFen" -> game.xiangqi.initialFen,
        "moves" -> game.xiangqi.moves.take(moveCount).map(_.value),
        "states" -> game.xiangqi.states.take(moveCount + 1),
        "ruleset" -> game.xiangqi.ruleset,
        "notations" -> game.xiangqi.wxf.take(moveCount),
        "notationsZh" -> game.xiangqi.chineseWxf.take(moveCount)
      )
      .add("clock", game.clock.map(_.config.show))
      .add("moveTime", game.moveTimeLimit.map(moveTimeJson))

  private def perfJson(game: Game) =
    Json.obj(
      "key" -> game.perfKey,
      "name" -> lila.rating.PerfType(game.perfKey).trans
    )

  private def playersJson(game: Game) = JsArray(game.players.mapList: p =>
    val player =
      p.userId match
        case Some(userId) => Json.toJsObject(lightUserApi.syncFallback(userId))
        case None => Json.obj("name" -> p.name.fold(LightUser.ghost.name.value)(_.value))
    player ++
      Json
        .obj("color" -> p.color.name)
        .add("rating" -> p.rating))

  private def generateBc(game: Game, plies: Ply): JsObject =
    val moveCount = moveCountFrom(game, plies)
    Json
      .obj(
        "id" -> game.id,
        "perf" -> perfJson(game),
        "players" -> playersJson(game),
        "rated" -> game.rated,
        "initialFen" -> game.xiangqi.initialFen,
        "moves" -> game.xiangqi.moves.take(moveCount).map(_.value),
        "states" -> game.xiangqi.states.take(moveCount + 1),
        "ruleset" -> game.xiangqi.ruleset,
        "notations" -> game.xiangqi.wxf.take(moveCount),
        "notationsZh" -> game.xiangqi.chineseWxf.take(moveCount),
        "tree" -> treeJson(game.xiangqi, moveCount)
      )
      .add("clock", game.clock.map(_.config.show))
      .add("moveTime", game.moveTimeLimit.map(moveTimeJson))

  private def treeJson(game: Xiangqi.Game, moveCount: Int): JsObject =
    lila.tree.Node.writeJson(
      lila.tree.Root.fromGame(
        game.copy(
          moves = game.moves.take(moveCount),
          wxf = game.wxf.take(moveCount),
          states = game.states.take(moveCount + 1)
        )
      )
    )

  private def moveCountFrom(game: Game, plies: Ply): Int =
    (plies.value - game.xiangqi.states.head.ply + 1).max(0)

  private def moveTimeJson(limit: lila.core.game.MoveTimeLimit) =
    Json
      .obj("seconds" -> limit.seconds)
      .add("first" -> limit.first.map: first =>
        Json.obj("moves" -> first.moves, "seconds" -> first.seconds))
