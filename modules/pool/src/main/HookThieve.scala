package lila.pool

import lila.common.Bus

final private class HookThieve(using Executor, Scheduler):

  import lila.core.pool.HookThieve.*

  def candidates(
      clock: chess.Clock.Config,
      moveTimeLimit: Option[lila.core.game.MoveTimeLimit]
  ): Fu[PoolHooks] =
    Bus
      .ask[PoolHooks, HookBus](HookBus.GetCandidates(clock, moveTimeLimit, _))
      .logFailure(logger)
      .recoverDefault(PoolHooks(Vector.empty))

  def stolen(poolHooks: Vector[PoolHook], monId: String) =
    lila.mon.lobby.pool.thieve.stolen(monId).record(poolHooks.size)
    if poolHooks.nonEmpty then Bus.pub(HookBus.StolenHookIds(poolHooks.map(_.hookId)))
