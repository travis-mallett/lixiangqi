package lila.threeKingdoms

import java.time.Instant

import lila.db.dsl.*
import lila.memo.CacheApi

/** Shared counts: homepage requests and socket broadcasts never issue per-visitor queries. */
final class Cached(repo: GameRepo, cacheApi: CacheApi)(using Executor):

  def homepageStats: Fu[Cached.HomepageStats] =
    homepage.get(())

  private val homepage = cacheApi[Unit, Cached.HomepageStats](1, "threeKingdoms.homepageStats"):
    _.expireAfterWrite(1.minute).buildAsyncFuture: _ =>
      repo.coll
        .countSel($doc("createdAt" -> $doc("$gte" -> Instant.now.minusSeconds(24.hours.toSeconds))))
        .zip(repo.coll.countAll)
        .map((today, total) => Cached.HomepageStats(today, total))

object Cached:
  case class HomepageStats(gamesPlayedToday: Int, gamesPlayedAllTime: Long)
