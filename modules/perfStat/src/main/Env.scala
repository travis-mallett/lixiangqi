package lila.perfStat

import com.softwaremill.macwire.*
import com.softwaremill.tagging.*

import lila.core.config.*

@Module
final class Env(
    mongoCache: lila.memo.MongoCache.Api,
    lightUser: lila.core.LightUser.GetterSyncFallback,
    lightUserApi: lila.core.user.LightUserApi,
    gameRepo: lila.core.game.GameRepo,
    userApi: lila.core.user.UserApi,
    rankingRepo: lila.core.user.RankingRepo,
    yoloDb: lila.db.AsyncDb @@ lila.db.YoloDb
)(using Executor, Scheduler):

  private lazy val storage = PerfStatStorage:
    yoloDb(CollName("perf_stat")).failingSilently()

  lazy val indexer = wire[PerfStatIndexer]

  lazy val api = wire[PerfStatApi]

  lazy val jsonView = wire[JsonView]

  lila.common.Bus.sub[lila.core.user.UserDelete]: del =>
    storage.deleteAllFor(del.id)
