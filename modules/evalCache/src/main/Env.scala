package lila.evalCache

import lila.xiangqi.{ Xiangqi, XiangqiEvaluation }
import lila.xiangqi.XiangqiJson.given
import play.api.libs.json.Json
import com.softwaremill.macwire.*
import com.softwaremill.tagging.*

import lila.core.config.CollName

@Module
final class Env(
    yoloDb: lila.db.AsyncDb @@ lila.db.YoloDb,
    cacheApi: lila.memo.CacheApi
)(using Executor, Scheduler):

  private lazy val coll = yoloDb(CollName("eval_cache2")).failingSilently()

  lazy val api: EvalCacheApi = wire[EvalCacheApi]

  def getSinglePvEval: lila.tree.CloudEval.GetSinglePvEval = api.getSinglePvEval

  lila.common.Cli.handle:
    case "eval-cache" :: "drop" :: positionJson =>
      scala.util
        .Try(Json.parse(positionJson.mkString(" ")).as[Xiangqi.Position])
        .toEither
        .left
        .map(_.getMessage)
        .flatMap(XiangqiEvaluation.game)
        .fold(
          fufail,
          game => api.drop(game).inject("Deleted the evaluation for this exact position and history")
        )
