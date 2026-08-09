package lila.game

import java.time.{ Instant, ZoneId, ZonedDateTime }

import com.github.blemale.scaffeine.LoadingCache

import lila.db.dsl.*
import lila.memo.{ CacheApi, MongoCache }

final class Cached(
    gameRepo: GameRepo,
    cacheApi: CacheApi,
    mongoCache: MongoCache.Api
)(using Executor):

  def nbImportedBy(userId: UserId): Fu[Int] = nbImportedCache.get(userId)
  export nbImportedCache.invalidate as clearNbImportedByCache
  export nbPlayingCache.get as nbPlaying

  def nbTotal: Fu[Long] = nbTotalCache.get {}

  def homepageStats: Fu[HomepageStats] = homepageStatsCache.get(todayStart)

  def lastPlayedPlayingId(userId: UserId): Fu[Option[GameId]] = lastPlayedPlayingIdCache.get(userId)

  private val lastPlayedPlayingIdCache: LoadingCache[UserId, Fu[Option[GameId]]] =
    CacheApi.scaffeineNoScheduler
      .expireAfterWrite(11.seconds)
      .build(gameRepo.lastPlayedPlayingId)

  lila.common.Bus.sub[lila.core.game.StartGame]: start =>
    start.game.userIds.foreach(lastPlayedPlayingIdCache.invalidate)

  private val nbPlayingCache = cacheApi[UserId, Int](1024, "game.nbPlaying"):
    _.expireAfterWrite(10.seconds).buildAsyncFuture: userId =>
      gameRepo.coll.countSel(Query.nowPlaying(userId))

  private val nbImportedCache = mongoCache[UserId, Int](4096, "game:imported", 30.days, _.value): loader =>
    _.expireAfterAccess(10.minutes).buildAsyncFuture:
      loader: userId =>
        gameRepo.coll.countSel(Query.imported(userId))

  private val nbTotalCache = mongoCache.unit[Long]("game:total", 29.minutes): loader =>
    _.refreshAfterWrite(30.minutes).buildAsyncFuture:
      loader: _ =>
        gameRepo.coll.countAll

  private val pacificTime = ZoneId.of("America/Los_Angeles")

  private def todayStart: Instant =
    ZonedDateTime.now(pacificTime).toLocalDate.atStartOfDay(pacificTime).toInstant

  private val homepageStatsCache = cacheApi[Instant, HomepageStats](2, "game.homepageStats"):
    _.expireAfterWrite(1.minute).buildAsyncFuture: startOfDay =>
      gameRepo
        .count(_.playedOnSiteSince(startOfDay))
        .zip(gameRepo.count(_.playedOnSite))
        .map(HomepageStats.apply)

case class HomepageStats(gamesPlayedToday: Int, gamesPlayedAllTime: Int)
