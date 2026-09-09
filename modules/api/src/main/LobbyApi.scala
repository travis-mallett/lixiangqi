package lila.api

import play.api.libs.json.{ JsObject, Json }

import lila.common.Json.given
import lila.core.perf.UserWithPerfs
import lila.lobby.LobbySocket
import lila.mon.extensions.*

final class LobbyApi(
    lightUserApi: lila.user.LightUserApi,
    gameProxyRepo: lila.round.GameProxyRepo,
    gameJson: lila.game.JsonView,
    lobbySocket: LobbySocket
)(using Executor):

  def get(using me: Option[UserWithPerfs]): Fu[(JsObject, List[Pov])] =
    me.traverse(gameProxyRepo.urgentGames)
      .mon(lila.mon.lobby.segment("urgentGames"))
      .flatMap: urgent =>
        val counters = lobbySocket.counters
        val povs = urgent.so(_.value)
        val displayedPovs = povs.take(9)
        for _ <- lightUserApi.preloadMany(displayedPovs.flatMap(_.opponent.userId))
        yield Json
          .obj(
            "nowPlaying" -> displayedPovs.map(nowPlaying),
            "nbNowPlaying" -> povs.size,
            "nbMyTurn" -> povs.count(_.isMyTurn),
            "counters" -> Json.obj(
              "members" -> counters.members,
              "rounds" -> counters.rounds
            ),
            "poolCounts" -> counters.poolCounts
          )
          .add(
            "me",
            me.map: u =>
              Json.obj("username" -> u.username).add("isBot" -> u.isBot)
          ) -> displayedPovs

  def nowPlaying(pov: Pov): JsObject = gameJson.ownerPreview(pov)(using lightUserApi.sync)
