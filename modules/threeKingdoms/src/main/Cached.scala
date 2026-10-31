package lila.threeKingdoms

import java.time.{ Instant, ZoneId, ZonedDateTime }

import lila.db.dsl.*
import lila.memo.CacheApi

/** Shared counts: homepage requests and socket broadcasts never issue per-visitor queries. */
final class Cached(repo: GameRepo, cacheApi: CacheApi)(using Executor):

  private val pacificTime = ZoneId.of("America/Los_Angeles")

  def homepageStats: Fu[Cached.HomepageStats] =
    homepage.get(ZonedDateTime.now(pacificTime).toLocalDate.atStartOfDay(pacificTime).toInstant)

  def nbPlaying: Fu[Int] = playing.get(())

  private val homepage = cacheApi[Instant, Cached.HomepageStats](2, "threeKingdoms.homepageStats"):
    _.expireAfterWrite(1.minute).buildAsyncFuture: startOfDay =>
      repo.coll
        .countSel($doc("createdAt" -> $doc("$gte" -> startOfDay)))
        .zip(repo.coll.countAll)
        .map((today, total) => Cached.HomepageStats(today, total))

  private val playing = cacheApi[Unit, Int](1, "threeKingdoms.nbPlaying"):
    _.expireAfterWrite(10.seconds).buildAsyncFuture: _ =>
      repo.coll.countSel($doc("finished" -> false))

object Cached:
  case class HomepageStats(gamesPlayedToday: Int, gamesPlayedAllTime: Long)
