package lila.fishnet

import org.apache.pekko.actor.CoordinatedShutdown
import io.lettuce.core.*
import io.lettuce.core.pubsub.*

import lila.common.{ Bus, Lilakka }
import lila.core.round.{ FishnetStart, RoundBus, Tell }
import lila.xiangqi.Xiangqi

/** Existing Lila AI-work transport, carrying Xiangqi positions and moves. */
final class FishnetRedis(
    client: RedisClient,
    chanIn: String,
    shutdown: CoordinatedShutdown
)(using Executor):

  private val connIn = client.connectPubSub()
  private val connOut = client.connectPubSub()
  private var stopping = false

  def request(work: Work.Move): Unit =
    if !stopping then connOut.async.publish(AiMoveProtocol.requestChannel, AiMoveProtocol.write(work))

  connIn.async.subscribe(chanIn, AiMoveProtocol.resultChannel)
  connIn.addListener:
    new RedisPubSubAdapter[String, String]:
      override def message(chan: String, msg: String): Unit =
        if chan == AiMoveProtocol.resultChannel then readV2(msg)
        else readLegacy(msg)

  private def readLegacy(msg: String): Unit =
    msg.split(' ') match
      case Array("start") => Bus.pub(FishnetStart)
      case Array(gameId, sign, uci) =>
        Xiangqi.Uci
          .from(uci)
          .foreach: move =>
            Bus.pub(Tell(GameId(gameId), RoundBus.FishnetPlay(move, sign)))
      case _ => ()

  private def readV2(msg: String): Unit =
    AiMoveProtocol
      .read(msg)
      .fold(
        error => logger.warn(s"Ignoring malformed AI worker message: $error"),
        {
          case AiMoveProtocol.Result.WorkerReady => Bus.pub(FishnetStart)
          case AiMoveProtocol.Result.Move(gameId, requestId, turnKey, uci) =>
            Bus.pub(Tell(gameId, RoundBus.FishnetPlayV2(uci, turnKey, requestId)))
          case AiMoveProtocol.Result.Failure(gameId, requestId, turnKey, code) =>
            Bus.pub(Tell(gameId, RoundBus.FishnetFailureV2(turnKey, requestId, code)))
        }
      )

  Lilakka.shutdown(shutdown, _.PhaseServiceUnbind, "Stopping the fishnet redis pool"): () =>
    Future:
      stopping = true
      client.shutdown()
