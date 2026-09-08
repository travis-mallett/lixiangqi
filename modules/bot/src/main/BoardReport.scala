package lila.bot

import lila.ui.Context
import lila.common.HTTPRequest
import lila.memo.SettingStore
import lila.core.rank.RankScore
import lila.core.rank.RankScore.*
import scala.util.matching.Regex
import scalalib.ThreadLocalRandom

private final class BoardReport(settingStore: SettingStore.Builder)(using
    ec: Executor,
    scheduler: Scheduler
):

  import SettingStore.Regex.given
  val domainSetting = settingStore[Regex](
    "boardApiBadRefererRegex",
    default = "-".r,
    text = "Board API: referer domains that use engine, as a regex".some
  )

  def move(game: Game)(using ctx: Context) = for
    me <- ctx.me
    rankScore <- game.player(me).flatMap(_.rank.map(_.score))
    if checkNow(game)
    ref <- HTTPRequest.referer(ctx.req)
    url <- lila.common.url.parse(ref).toOption
    domain = url.host.toString
    if domainSetting.get().matches(domain)
  yield found(me, game, rankScore, ref)

  private def found(me: Me, game: Game, rankScore: RankScore, ref: String): Unit =
    val delayBase =
      if rankScore.value >= 2500 then 0
      else if rankScore.value >= 1200 then 1
      else if rankScore.value >= 600 then 6
      else if rankScore.value >= 240 then 12
      else 24
    val jitter = if delayBase == 0 then 0 else ThreadLocalRandom.nextInt(delayBase * 60)
    val minutes = 2 + delayBase + jitter
    lila.log.system.warn:
      s"Marking https://lixiangqi.org/@/${me.username} for https://lixiangqi.org/${game.id} with $ref in $minutes minutes"
    scheduler.scheduleOnce(minutes.minutes):
      lila.common.Bus.pub(lila.core.mod.BoardApiMark(me.userId, ref))

  private def checkNow(game: Game): Boolean =
    game.ply.value == 5 + (game.createdAt.toSeconds % 20)
