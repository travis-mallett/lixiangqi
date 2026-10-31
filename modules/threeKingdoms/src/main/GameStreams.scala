package lila.threeKingdoms

import org.apache.pekko.NotUsed
import org.apache.pekko.stream.OverflowStrategy
import org.apache.pekko.stream.scaladsl.{ Source, SourceQueueWithComplete }
import play.api.libs.json.{ Json, JsObject }

/** Only subscribers to a changed match receive updates. Clocks animate locally between moves. */
final class GameStreams(repo: GameRepo, json: JsonView)(using Executor):
  private var listeners = Map.empty[String, Map[String, SourceQueueWithComplete[KingdomGame]]]
  def publish(game: KingdomGame): Unit = publishChannel(s"game:${game.id.value}", game)
  def publishChannel(channel: String, game: KingdomGame): Unit =
    val queues = synchronized(listeners.get(channel).toList.flatMap(_.values))
    queues.foreach(_.offer(game))
  def apply(id: GameId): Source[JsObject, NotUsed] =
    channel(s"game:${id.value}", repo.byId(id), closeIfEmpty = true)

  def channel(
      channel: String,
      initial: => Fu[Option[KingdomGame]],
      closeIfEmpty: Boolean = false
  ): Source[JsObject, NotUsed] =
    val key = scalalib.SecureRandom.nextString(12)
    Source
      .queue[KingdomGame](8, OverflowStrategy.dropHead)
      .mapMaterializedValue: queue =>
        synchronized:
          listeners = listeners.updated(channel, listeners.getOrElse(channel, Map.empty).updated(key, queue))
        initial.foreach:
          case Some(game) => queue.offer(game)
          case None => if closeIfEmpty then queue.complete()
        queue
          .watchCompletion()
          .onComplete: _ =>
            synchronized:
              listeners
                .get(channel)
                .foreach: entries =>
                  val remaining = entries - key
                  listeners =
                    if remaining.isEmpty then listeners - channel else listeners.updated(channel, remaining)
        NotUsed
      .map(g => json(g))
      .keepAlive(15.seconds, () => Json.obj("heartbeat" -> nowMillis))
