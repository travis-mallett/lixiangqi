package lila.pool

import com.softwaremill.macwire.*

@Module
final class Env(
    userApi: lila.core.user.UserApi,
    gameRepo: lila.core.game.GameRepo,
    newPlayer: lila.core.game.NewPlayer,
    idGenerator: lila.core.game.IdGenerator,
    hasCurrentPlayban: lila.core.playban.HasCurrentPlayban,
    rageSitOf: lila.core.playban.RageSitOf,
    participation: lila.core.pool.PoolParticipation,
    mayJoinPool: lila.core.pool.MayJoinPool
)(using Executor, org.apache.pekko.actor.ActorSystem, Scheduler):

  private val hookThieve = wire[HookThieve]

  val onStart = (gameId: GameId) => lila.common.Bus.pub(lila.core.game.GameStart(gameId))

  private val gameStarter = wire[GameStarter]

  val api = wire[PoolApi]

  lila.common.Bus.sub[lila.core.game.FinishGame]: event =>
    participation.release(event.game.id, event.game.userIds)

  export PoolList.{ all, isClockCompatible }
