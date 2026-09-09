package lila.core
package pool

import _root_.chess.{ Clock, ByColor }
import alleycats.Zero

import scalalib.bus.NotBuseable

import lila.core.rank.{ RankSnapshot, RankTrackId }
import lila.core.socket.Sri
import lila.core.userId.*
import lila.core.id.GameFullId
import lila.core.game.MoveTimeLimit

opaque type Blocking = Set[UserId]
object Blocking extends TotalWrapper[Blocking, Set[UserId]]:
  given Zero[Blocking] = Zero(Set.empty)

opaque type PoolConfigId = String
object PoolConfigId extends OpaqueString[PoolConfigId]:

  def from(clock: Clock.Config, moveTimeLimit: Option[MoveTimeLimit]): PoolConfigId =
    PoolConfigId:
      moveTimeLimit.fold(clock.show): limit =>
        val opening = limit.first.fold("")(first => s"-${first.seconds}x${first.moves}")
        s"${clock.show}-m${limit.seconds}$opening"

opaque type IsClockCompatible = (Clock.Config, Option[MoveTimeLimit]) => Boolean
object IsClockCompatible
    extends FunctionWrapper[IsClockCompatible, (Clock.Config, Option[MoveTimeLimit]) => Boolean]

enum PoolFrom:
  case Socket, Api, Hook

case class PoolMember(
    userId: UserId,
    sri: Sri,
    from: PoolFrom,
    rank: RankSnapshot,
    lame: Boolean,
    blocking: Blocking,
    rageSitCounter: Int = 0,
    misses: Int = 0 // how many waves they missed
)

case class Pairing(players: ByColor[(Sri, GameFullId)])
case class Pairings(pairings: List[Pairing])

object HookThieve:

  enum HookBus:
    case GetCandidates(
        clock: Clock.Config,
        moveTimeLimit: Option[MoveTimeLimit],
        promise: Promise[PoolHooks]
    )
    case StolenHookIds(ids: Vector[String])

  case class PoolHook(hookId: String, member: PoolMember) extends NotBuseable

  case class PoolHooks(hooks: Vector[PoolHook]) extends NotBuseable

trait PoolApi:
  def setOnlineSris(ids: socket.Sris): Unit
  def poolRankTracks: Map[PoolConfigId, Option[RankTrackId]]
  def homepagePoolIds: Set[PoolConfigId]
  def join(poolId: PoolConfigId, member: PoolMember): Unit
  def leave(poolId: PoolConfigId, user: UserId): Unit
  def poolOf(clock: Clock.Config, moveTimeLimit: Option[MoveTimeLimit]): Option[PoolConfigId]

  final def homepagePoolOf(
      clock: Clock.Config,
      moveTimeLimit: Option[MoveTimeLimit]
  ): Option[PoolConfigId] = poolOf(clock, moveTimeLimit).filter(homepagePoolIds)
