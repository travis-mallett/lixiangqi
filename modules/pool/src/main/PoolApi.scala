package lila.pool

import org.apache.pekko.actor.*

import lila.core.pool.{ PoolMember, PoolConfigId }
import lila.core.socket.Sris

final class PoolApi(
    val configs: List[PoolConfig],
    hookThieve: HookThieve,
    gameStarter: GameStarter,
    hasCurrentPlayban: lila.core.playban.HasCurrentPlayban,
    rageSitOf: lila.core.playban.RageSitOf,
    system: ActorSystem,
    participation: lila.core.pool.PoolParticipation,
    mayJoinPool: lila.core.pool.MayJoinPool
)(using Executor)
    extends lila.core.pool.PoolApi:
  import PoolActor.*

  private val actors: Map[PoolConfigId, ActorRef] = configs
    .map: config =>
      config.id -> system
        .actorOf(
          Props(PoolActor(config, hookThieve, gameStarter)),
          name = s"pool-${config.id}"
        )
    .toMap

  val poolRankTracks = configs
    .map: config =>
      config.id -> config.rankTrack
    .toMap

  val homepagePoolIds: Set[PoolConfigId] = PoolList.homepage.iterator.map(_.id).toSet

  def join(poolId: PoolConfigId, member: PoolMember): Unit =
    hasCurrentPlayban(member.userId)
      .zip(mayJoinPool.exec(member.userId))
      .foreach:
        case (false, true) if participation.join(member.userId, poolId.value, nowMillis) =>
          actors.foreach: (id, actor) =>
            if id == poolId then
              rageSitOf(member.userId).foreach: rageSit =>
                actor ! Join(member.copy(rageSitCounter = rageSit.counterView))
            else actor ! Leave(member.userId)
        case _ =>

  def leave(poolId: PoolConfigId, userId: UserId) =
    participation.leave(userId, poolId.value)
    sendTo(poolId, Leave(userId))

  def poolOf(
      clock: chess.Clock.Config,
      moveTimeLimit: Option[lila.core.game.MoveTimeLimit],
      variant: lila.xiangqi.GameVariant
  ): Option[PoolConfigId] =
    configs
      .find(p =>
        p.clock == clock && p.moveTimeLimit == moveTimeLimit &&
          p.gameVariant == variant
      )
      .map(_.id)

  def setOnlineSris(ids: Sris): Unit = actors.values.foreach(_ ! ids)

  private def sendTo(poolId: PoolConfigId, msg: Any) =
    actors.get(poolId).foreach { _ ! msg }
