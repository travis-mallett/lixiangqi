package lila.threeKingdoms

import com.softwaremill.macwire.*
import lila.core.config.CollName

@Module
final class Env(
    db: lila.db.Db,
    cacheApi: lila.memo.CacheApi,
    users: lila.user.UserApi,
    userRepo: lila.user.UserRepo,
    lightUser: lila.core.LightUser.GetterSyncFallback,
    relations: lila.core.relation.RelationApi,
    granter: lila.challenge.ChallengeGranter,
    notifyApi: lila.notify.NotifyApi,
    hasCurrentPlayban: lila.core.playban.HasCurrentPlayban,
    participation: lila.core.pool.PoolParticipation
)(using Executor, Scheduler):
  val repo = GameRepo(db(CollName("three_kingdoms_game")))
  val cached = wire[Cached]
  val json = wire[JsonView]
  val streams = wire[GameStreams]
  val maker = wire[GameMaker]
  private val accounting = wire[GameAccounting]
  val api = wire[GameApi]
  val pool = wire[PoolApi]
  val challenges =
    ChallengeApi(db(CollName("three_kingdoms_challenge")), maker, users, granter, relations, notifyApi)
  private var sweeping = false
  summon[Scheduler].scheduleWithFixedDelay(3.seconds, 1.second): () =>
    synchronized:
      if !sweeping then
        sweeping = true
        api
          .tick()
          .flatMap(_ => api.finishUnattendedDuels())
          .onComplete: result =>
            result.failed.foreach(e => logger.error("Clock sweep failed", e))
            synchronized { sweeping = false }
  summon[Scheduler].scheduleWithFixedDelay(10.seconds, 1.minute): () =>
    api.recoverSettlements().failed.foreach(e => logger.error("Settlement recovery failed", e))
    challenges.recover().failed.foreach(e => logger.error("Challenge recovery failed", e))
