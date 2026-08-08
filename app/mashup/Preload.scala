package lila.app
package mashup

import play.api.libs.json.*

import lila.core.game.Game
import lila.core.perf.UserWithPerfs
import lila.core.user.LightPerf
import lila.core.user.{ FlagCode, LightUserApi, UserApi }
import lila.playban.TempBan
import lila.user.Me
import lila.mon.extensions.*

final class Preload(
    tv: lila.tv.Tv,
    gameRepo: lila.game.GameRepo,
    perfsRepo: lila.user.UserPerfsRepo,
    lobbyApi: lila.api.LobbyApi,
    playbanApi: lila.playban.PlaybanApi,
    lightUserApi: LightUserApi,
    userApi: UserApi,
    userCached: lila.user.Cached,
    roundProxy: lila.round.GameProxyRepo,
    getLastUpdates: lila.feed.Feed.GetLastUpdates,
    unreadCount: lila.msg.MsgUnreadCount,
    notifyApi: lila.notify.NotifyApi
)(using Executor):

  import Preload.*

  def apply()(using ctx: Context): Fu[Homepage] = for
    nbNotifications <- ctx.me.so(notifyApi.unreadCount(_))
    withPerfs <- ctx.user.traverse(perfsRepo.withPerfs)
    given Option[UserWithPerfs] = withPerfs
    (data, povs) <- lobbyApi.get.mon(lila.mon.lobby.segment("lobbyApi"))
    featured <- tv.getBestGame.mon(lila.mon.lobby.segment("tvBestGame"))
    playban <- ctx.userId.so(playbanApi.currentBan).mon(lila.mon.lobby.segment("playban"))
    lichessMsg <- ctx.userId.ifTrue(nbNotifications > 0).so(unreadCount.hasLichessMsg)
    leaderboards <- userCached.top10.get({}).mon(lila.mon.lobby.segment("leaderboard"))
    leaderboard = homepageLeaderboard(leaderboards)
    leaderboardUsers <- userApi.byIds(leaderboard.map(_.user.id))
    leaderboardFlags = leaderboardUsers
      .flatMap: user =>
        user.profile.flatMap(_.flag).map(user.id -> _)
      .toMap
    (currentGame, _) <- ctx.me
      .soUse(currentGameMyTurn(povs, lightUserApi.sync))
      .mon(lila.mon.lobby.segment("currentGame"))
      .zip(lightUserApi.preloadMany(leaderboard.map(_.user.id)))
  yield Homepage(
    data,
    featured,
    playban,
    currentGame,
    getLastUpdates(),
    leaderboard,
    leaderboardFlags,
    hasUnreadLichessMessage = lichessMsg
  )

  private def homepageLeaderboard(leaderboards: lila.rating.UserPerfs.Leaderboards): List[LightPerf] =
    (leaderboards.rapid.take(6) ::: leaderboards.classical.take(4) ::: leaderboards.blitz.take(2))
      .groupBy(_.user.id)
      .values
      .map(_.maxBy(_.rating.value))
      .toList
      .sortBy(-_.rating.value)
      .take(8)

  def currentGameMyTurn(using me: Me): Fu[Option[CurrentGame]] =
    gameRepo
      .playingRealtimeNoAi(me)
      .flatMap:
        _.map { roundProxy.pov(_, me) }.parallel.dmap(_.flatten)
      .flatMap:
        currentGameMyTurn(_, lightUserApi.sync)

  private def currentGameMyTurn(povs: List[Pov], lightUser: lila.core.LightUser.GetterSync)(using
      me: Me
  ): Fu[Option[CurrentGame]] =
    ~povs.collectFirst:
      case p1 if p1.game.nonAi && p1.game.hasClock && p1.isMyTurn =>
        roundProxy.pov(p1.gameId, me).dmap(_ | p1).map { pov =>
          val opponent = lila.game.Namer.playerTextBlocking(pov.opponent)(using lightUser)
          CurrentGame(pov = pov, opponent = opponent).some
        }

object Preload:

  case class Homepage(
      data: JsObject,
      featured: Option[Game],
      playban: Option[TempBan],
      currentGame: Option[Preload.CurrentGame],
      lastUpdates: List[lila.feed.Feed.Update],
      leaderboard: List[LightPerf],
      leaderboardFlags: Map[UserId, FlagCode],
      hasUnreadLichessMessage: Boolean
  )

  case class CurrentGame(pov: Pov, opponent: String)
