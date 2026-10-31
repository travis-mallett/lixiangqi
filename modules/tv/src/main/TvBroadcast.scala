package lila.tv

import org.apache.pekko.actor.*
import org.apache.pekko.stream.scaladsl.*
import org.apache.pekko.pattern.pipe
import play.api.libs.json.*

import lila.common.Bus
import lila.common.actorBus.*
import lila.common.Json.given
import lila.core.LightUser
import lila.core.game.TvSelect
import lila.core.rank.RankCode.*
import lila.core.socket.makeMessage
import lila.game.actorApi.MoveGameEvent

final private class TvBroadcast(
    lightUserSync: LightUser.GetterSync,
    channel: Tv.Channel,
    gameProxy: lila.core.game.GameProxy
) extends Actor:

  import TvBroadcast.*

  private var clients = Set.empty[Client]

  private var featured = none[Featured]
  private var featuredHtml = none[JsObject]
  private var selectedId = none[GameId]
  private var lastMove = none[JsObject]
  private var pendingMove = none[MoveGameEvent]
  private var featuredMovedAt = java.time.Instant.MIN

  Bus.subscribeActorRef[lila.core.game.TvSelect](self)

  given Executor = context.system.dispatcher
  given Scheduler = context.system.scheduler

  override def postStop() =
    super.postStop()
    unsubscribeFromFeaturedId()
    Bus.unsubscribeActorRef[lila.core.game.TvSelect](self)
    clients.foreach(_.queue.complete())

  def receive =

    case TvBroadcast.Connect(compat) =>
      sender() ! Source
        .queue[JsValue](8, org.apache.pekko.stream.OverflowStrategy.dropHead)
        .mapMaterializedValue { queue =>
          val client = Client(queue, compat)
          self ! Add(client)
          queue
            .watchCompletion()
            .addEffectAnyway:
              self ! Remove(client)
        }

    case Add(client) =>
      clients = clients + client
      if client.fromLichess then
        featuredHtml.foreach(msg => client.queue.offer(msg))
        lastMove.foreach(msg => client.queue.offer(msg))
      else featured.foreach(f => client.queue.offer(f.socketMsg))
    case Remove(client) => clients = clients - client

    case TvSelect(gameId, speed, chanKey, data) if chanKey == channel.key =>
      selectedId.foreach(id => Bus.unsubscribeActorRefDyn(self, MoveGameEvent.makeChan(id)))
      selectedId = gameId.some
      pendingMove = None
      Bus.subscribeActorRefDyn(self, List(MoveGameEvent.makeChan(gameId)))
      gameProxy
        .game(gameId)
        .map2: game =>
          Bus
            .ask[Html, RenderFeaturedJs](RenderFeaturedJs(game, _, channel.key.some))
            .map(BroadcastGame(game, data, _))
            .pipeTo(self)

    case BroadcastGame(game, data, html) if selectedId.contains(game.id) =>
      val pov = Pov.naturalOrientation(game)
      val feat = Featured(
        game.id,
        Json.obj(
          "id" -> game.id,
          "orientation" -> pov.color.name,
          "players" -> game.players.mapList: p =>
            val user = p.userId.flatMap(lightUserSync)
            Json
              .obj("color" -> p.color.name)
              .add("user" -> user)
              .add("ai" -> p.aiLevel)
              .add("rank" -> p.rank.flatMap(_.publicCode).map(_.value))
              .add("seconds" -> game.clock.map(_.remainingTime(p.color).roundSeconds))
        ),
        fen = game.position.fen
      )
      lazy val featuredHtmlMsg = makeMessage(
        "featured",
        Json.obj(
          "html" -> html.toString,
          "color" -> game.naturalOrientation.name,
          "id" -> game.id
        )
      )
      clients.foreach: client =>
        client.queue.offer:
          if client.fromLichess then featuredHtmlMsg
          else feat.socketMsg
      featured = feat.some
      featuredMovedAt = game.movedAt
      featuredHtml = featuredHtmlMsg.some
      lastMove = None
      pendingMove.foreach(self ! _)
      pendingMove = None

    case event: MoveGameEvent
        if selectedId.contains(event.game.id) && !featured.exists(_.id == event.game.id) =>
      pendingMove = event.some

    case MoveGameEvent(game, fen, move)
        if featured.exists(_.id == game.id) && !game.movedAt.isBefore(featuredMovedAt) =>
      featuredMovedAt = game.movedAt
      val msg = makeMessage(
        "fen",
        Json
          .obj(
            "fen" -> fen,
            "lm" -> move.value
          )
          .add("wc" -> game.clock.map(_.remainingTime(chess.White).roundSeconds))
          .add("bc" -> game.clock.map(_.remainingTime(chess.Black).roundSeconds))
          .add("mt" -> game.moveTimeRemaining.map(_.roundSeconds))
      )
      clients.foreach(_.queue.offer(msg))
      lastMove = msg.some
      featured.foreach { f =>
        val players = (f.data \ "players")
          .as[List[JsObject]]
          .map: player =>
            val color = if (player \ "color").as[String] == "white" then chess.White else chess.Black
            player ++ Json.obj("seconds" -> game.clock.map(_.remainingTime(color).roundSeconds))
        featured = f.copy(fen = fen, data = f.data ++ Json.obj("players" -> players, "lm" -> move.value)).some
      }

    case _: BroadcastGame | _: MoveGameEvent => ()

  def unsubscribeFromFeaturedId() =
    selectedId.foreach { id =>
      Bus.unsubscribeActorRefDyn(self, MoveGameEvent.makeChan(id))
    }

object TvBroadcast:

  type SourceType = Source[JsValue, ?]
  type Queue = SourceQueueWithComplete[JsValue]

  case class Featured(id: GameId, data: JsObject, fen: String):
    def dataWithFen = data ++ Json.obj("fen" -> fen)
    def socketMsg = makeMessage("featured", dataWithFen)

  case class Connect(bc: Boolean)
  case class Client(queue: Queue, fromLichess: Boolean)

  case class BroadcastGame(game: Game, data: JsObject, html: Html)

  case class Add(c: Client)
  case class Remove(c: Client)
