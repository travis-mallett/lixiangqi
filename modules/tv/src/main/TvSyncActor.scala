package lila.tv

import play.api.libs.json.Json
import scalalib.actor.SyncActor

import lila.common.Bus
import lila.common.Json.given
import lila.core.rank.RankScore.*

final private class TvSyncActor(
    lightUserApi: lila.core.user.LightUserApi,
    onTvGame: lila.game.core.OnTvGame,
    gameProxy: lila.core.game.GameProxy,
    rematches: lila.game.Rematches,
    historyRepo: TvHistory,
    userApi: lila.core.user.UserApi
)(using Executor, Scheduler)
    extends SyncActor:

  import TvSyncActor.*

  Bus.subscribeActor[lila.core.game.StartGame](this)
  Bus.subscribeActor[lila.game.actorApi.MoveGameEvent](this)

  private val channelActors: Map[Tv.Channel, ChannelSyncActor] = Tv.Channel.values.map { c =>
    c -> ChannelSyncActor(
      c,
      onSelect = this.!,
      gameProxy,
      rematches.getAcceptedId,
      lightUserApi.sync,
      userApi,
      historyRepo
    )
  }.toMap

  private var channelChampions = Map[Tv.Channel, Tv.Champion]()

  private def forward[A](channel: Tv.Channel, msg: Any) =
    channelActors.get(channel).foreach { _ ! msg }

  protected val process: SyncActor.Receive =

    case GetGameId(channel, promise) =>
      forward(channel, ChannelSyncActor.GetGameId(promise))

    case GetGameIdAndHistory(channel, promise) =>
      forward(channel, ChannelSyncActor.GetGameIdAndHistory(promise))

    case GetGameIds(channel, max, promise) =>
      forward(channel, ChannelSyncActor.GetGameIds(max, promise))

    case GetReplacementGameId(channel, oldId, exclude, promise) =>
      forward(channel, ChannelSyncActor.GetReplacementGameId(oldId, exclude, promise))

    case GetChampions(promise) => promise.success(Tv.Champions(channelChampions))

    case lila.core.game.StartGame(g, users) =>
      addCandidate(Tv.Candidate(g, users.exists(_.exists(_.isBot))))

    // Activity refreshes candidates and discovers games resumed after a server restart.
    case lila.game.actorApi.MoveGameEvent(game, _, _) =>
      addCandidate(Tv.Candidate(game, game.userIds.flatMap(lightUserApi.sync).exists(_.isBot)))

    case s @ TvSyncActor.Select => channelActors.foreach(_._2 ! s)

    case Selected(channel, game) =>
      addCandidate(Tv.Candidate(game, game.userIds.flatMap(lightUserApi.sync).exists(_.isBot)))
      if channel.listed then
        import lila.core.socket.makeMessage
        given Ordering[lila.core.game.Player] = Ordering.by: p =>
          p.rank.fold(Int.MinValue)(_.score.value) + ~p.userId
            .flatMap(lightUserApi.sync)
            .flatMap(_.title)
            .flatMap(Tv.titleScores.get)
        val player =
          game.players.all.filter(_.userId.isDefined).sorted.lastOption | game.player(game.naturalOrientation)
        val user = player.userId.flatMap(lightUserApi.sync)
        channelChampions -= channel
        user.foreach: u =>
          channelChampions += (channel -> Tv.Champion(
            u,
            player.rank.flatMap(_.publicCode),
            game.id,
            player.color
          ))
        onTvGame(game)
        val data = Json.obj(
          "channel" -> channel.key,
          "id" -> game.id,
          "color" -> game.naturalOrientation.name,
          "player" -> user.map: u =>
            Json.obj(
              "name" -> u.name,
              "title" -> u.title,
              "rank" -> player.rank.flatMap(_.publicCode).map(_.value)
            )
        )
        Bus.pub(lila.core.game.TvSelect(game.id, game.speed, channel.key, data))
        if channel == Tv.Channel.Xiangqi then
          lila.common.Bus
            .ask[Html, RenderFeaturedJs](RenderFeaturedJs(game, _, channel.key.some))
            .foreach: html =>
              Bus.pub:
                lila.core.game.ChangeFeatured:
                  makeMessage(
                    "featured",
                    Json.obj(
                      "html" -> html,
                      "color" -> game.naturalOrientation.name,
                      "id" -> game.id
                    )
                  )

  private def addCandidate(candidate: Tv.Candidate): Unit =
    channelActors.foreach: (channel, actor) =>
      if channel.filter(candidate) then actor.addCandidate(candidate.game)

private object TvSyncActor:

  case class GetGameId(channel: Tv.Channel, promise: Promise[Option[GameId]])
  case class GetGameIds(channel: Tv.Channel, max: Int, promise: Promise[List[GameId]])
  case class GetReplacementGameId(
      channel: Tv.Channel,
      oldId: GameId,
      exclude: List[GameId],
      promise: Promise[Option[GameId]]
  )

  case class GetGameIdAndHistory(channel: Tv.Channel, promise: Promise[ChannelSyncActor.GameIdAndHistory])

  case object Select
  case class Selected(channel: Tv.Channel, game: Game)

  case class GetChampions(promise: Promise[Tv.Champions])
