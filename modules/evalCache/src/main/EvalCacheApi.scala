package lila.evalCache

import lila.memo.CacheApi.invalidate

import lila.xiangqi.Xiangqi.Game
import play.api.libs.json.JsObject

import lila.core.chess.MultiPv
import lila.db.AsyncCollFailingSilently
import lila.db.dsl.{ *, given }
import lila.tree.CloudEval

final class EvalCacheApi(coll: AsyncCollFailingSilently, cacheApi: lila.memo.CacheApi)(using Executor):

  import BSONHandlers.given

  def getEvalJson(game: Game, multiPv: MultiPv): Fu[Option[JsObject]] =
    getEval(Id(game), multiPv)
      .map2(JsonView.writeEval(_, game))
      .addEffect: res =>
        lila.mon.evalCache.request(res.isDefined).increment()

  val getSinglePvEval: CloudEval.GetSinglePvEval = sit => getEval(Id(sit), MultiPv(1))

  private[evalCache] def drop(game: Game): Funit =
    val id = Id(game)
    coll(_.delete.one($id(id)).void).addEffect: _ =>
      cache.invalidate(id)

  private def getEval(id: Id, multiPv: MultiPv): Fu[Option[CloudEval]] =
    cache.get(id).map(_.flatMap(_.makeBestMultiPvEval(multiPv)))

  private val cache = cacheApi[Id, Option[EvalCacheEntry]](16_384, "evalCache"):
    _.expireAfterWrite(4.minutes).buildAsyncFuture: id =>
      coll: c =>
        c.one[EvalCacheEntry]($id(id))
          .addEffect: res =>
            if res.isDefined then c.updateFieldUnchecked($id(id), "usedAt", nowInstant)
