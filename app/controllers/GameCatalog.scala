package controllers

import java.time.{ DayOfWeek, Instant, ZoneId, ZonedDateTime }
import java.time.temporal.TemporalAdjusters

import lila.app.*

final class GameCatalog(env: Env) extends LilaController(env):

  private val pacificTime = ZoneId.of("America/Los_Angeles")

  private def currentWeekStart: Instant =
    ZonedDateTime
      .now(pacificTime)
      .toLocalDate
      .`with`(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY))
      .atStartOfDay(pacificTime)
      .toInstant

  private val nativeWeeklyCount = env.memo.cacheApi[Instant, Int](2, "gameCatalog.nativeWeeklyCount"):
    _.expireAfterWrite(1.minute)
      .maximumSize(2)
      .buildAsyncFuture: start =>
        env.game.gameRepo.count(_.createdSince(start))

  def index = Open:
    nativeWeeklyCount
      .get(currentWeekStart)
      .flatMap: count =>
        Ok.page(views.xiangqi.gamesDatabase(env.fishnet.explorerEndpoint, count))

  def player(player: String) = Open:
    val normalized = player.trim
    if normalized.isEmpty || normalized.length > 100 then BadRequest("Invalid database player")
    else Ok.page(views.xiangqi.databasePlayer(env.fishnet.explorerEndpoint, normalized))

  def event(event: String) = Open:
    val normalized = event.trim
    if normalized.isEmpty || normalized.length > 100 then BadRequest("Invalid database event")
    else Ok.page(views.xiangqi.databaseEvent(env.fishnet.explorerEndpoint, normalized))
