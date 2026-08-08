package lila.puzzle

import chess.Ply
import play.api.libs.json.*

import lila.common.Json.given
import lila.core.LightUser

final private class GameJson(
    gameRepo: lila.core.game.GameRepo,
    sourceGameJson: SourceGameJson,
    cacheApi: lila.memo.CacheApi,
    lightUserApi: lila.core.user.LightUserApi
)(using Executor, lila.core.i18n.Translator):

  given play.api.i18n.Lang = lila.core.i18n.defaultLang

  def apply(puzzle: Puzzle, bc: Boolean): Fu[JsObject] =
    (if bc then bcCache else cache).get(Key(puzzle.gameRef, puzzle.initialPly))

  def noCache(game: Game, plies: Ply): Fu[JsObject] =
    lightUserApi.preloadMany(game.userIds).inject(generate(game, plies))

  def noCacheBc(game: Game, plies: Ply): Fu[JsObject] =
    lightUserApi.preloadMany(game.userIds).inject(generateBc(game, plies))

  private case class Key(game: Puzzle.GameRef, plies: Ply)

  private val cache = cacheApi[Key, JsObject](4096, "puzzle.gameJson"):
    _.expireAfterAccess(5.minutes)
      .maximumSize(4096)
      .buildAsyncFuture(generate(_, false))

  private val bcCache = cacheApi[Key, JsObject](1024, "puzzle.bc.gameJson"):
    _.expireAfterAccess(5.minutes)
      .maximumSize(1024)
      .buildAsyncFuture(generate(_, true))

  private def generate(key: Key, bc: Boolean): Fu[JsObject] = key.game match
    case Puzzle.GameRef.Lila(gameId) =>
      gameRepo.gameFromSecondary(gameId).orFail(s"Missing puzzle game $gameId!").flatMap { game =>
        lightUserApi
          .preloadMany(game.userIds)
          .inject:
            if bc then generateBc(game, key.plies)
            else generate(game, key.plies)
      }
    case source: Puzzle.GameRef.Catalog =>
      sourceGameJson(source, key.plies, bc)

  private def generate(game: Game, plies: Ply): JsObject =
    val moveCount = plies.value + 1
    Json
      .obj(
        "id" -> game.id,
        "perf" -> perfJson(game),
        "rated" -> game.rated,
        "players" -> playersJson(game),
        "pgn" -> game.xiangqi.wxf.take(moveCount).mkString(" "),
        "initialFen" -> game.xiangqi.initialFen,
        "moves" -> game.xiangqi.moves.take(moveCount).map(_.value),
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
    val moveCount = plies.value + 1
    Json
      .obj(
        "id" -> game.id,
        "perf" -> perfJson(game),
        "players" -> playersJson(game),
        "rated" -> game.rated,
        "initialFen" -> game.xiangqi.initialFen,
        "moves" -> game.xiangqi.moves.take(moveCount).map(_.value),
        "notations" -> game.xiangqi.wxf.take(moveCount),
        "notationsZh" -> game.xiangqi.chineseWxf.take(moveCount),
        "treeParts" -> game.xiangqi.states
          .lift(moveCount)
          .map: position =>
            Json
              .obj(
                "fen" -> position.fen,
                "ply" -> position.ply
              )
              .add("san", game.xiangqi.wxf.lift(moveCount - 1))
              .add("sanZh", game.xiangqi.chineseWxf.lift(moveCount - 1))
              .add("uci", game.xiangqi.moves.lift(moveCount - 1).map(_.value))
      )
      .add("clock", game.clock.map(_.config.show))
      .add("moveTime", game.moveTimeLimit.map(moveTimeJson))

  private def moveTimeJson(limit: lila.core.game.MoveTimeLimit) =
    Json
      .obj("seconds" -> limit.seconds)
      .add("first" -> limit.first.map: first =>
        Json.obj("moves" -> first.moves, "seconds" -> first.seconds))
