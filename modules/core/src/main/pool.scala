package lila.core
package pool

import _root_.chess.{ Clock, ByColor }
import _root_.chess.IntRating
import alleycats.Zero

import scalalib.bus.NotBuseable

import lila.core.perf.PerfKey
import lila.core.rating.RatingRange
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

case class HomepageGameCounts(
    poolGames: Map[PoolConfigId, Int],
    friendGames: Int,
    aiGames: Int,
    lobbyPlayers: Int
):
  def poolPlayers(poolId: PoolConfigId, waitingPlayers: Int): Int =
    waitingPlayers + poolGames.getOrElse(poolId, 0) * 2
  def friendPlayers: Int = friendGames * 2
  def aiPlayers: Int = aiGames
  def updateActiveGame(
      homepagePoolId: Option[PoolConfigId],
      humanPlayers: Int,
      delta: Int
  ): HomepageGameCounts = homepagePoolId match
    case Some(poolId) =>
      val next = (poolGames.getOrElse(poolId, 0) + delta).max(0)
      copy(poolGames = poolGames.updated(poolId, next))
    case None => copy(lobbyPlayers = (lobbyPlayers + humanPlayers * delta).max(0))

opaque type IsClockCompatible = (Clock.Config, Option[MoveTimeLimit]) => Boolean
object IsClockCompatible
    extends FunctionWrapper[IsClockCompatible, (Clock.Config, Option[MoveTimeLimit]) => Boolean]

enum PoolFrom:
  case Socket, Api, Hook

case class PoolMember(
    userId: UserId,
    sri: Sri,
    from: PoolFrom,
    rating: IntRating,
    provisional: Boolean,
    ratingRange: Option[RatingRange],
    lame: Boolean,
    blocking: Blocking,
    rageSitCounter: Int = 0,
    misses: Int = 0 // how many waves they missed
)

case class Pairing(players: ByColor[(Sri, GameFullId)])
case class Pairings(pairings: List[Pairing])
case class PoolCount(poolId: PoolConfigId, members: Int)

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
  def poolPerfKeys: Map[PoolConfigId, PerfKey]
  def homepagePoolIds: Set[PoolConfigId]
  def join(poolId: PoolConfigId, member: PoolMember): Unit
  def leave(poolId: PoolConfigId, user: UserId): Unit
  def poolOf(clock: Clock.Config, moveTimeLimit: Option[MoveTimeLimit]): Option[PoolConfigId]

  final def homepagePoolOf(
      clock: Clock.Config,
      moveTimeLimit: Option[MoveTimeLimit]
  ): Option[PoolConfigId] = poolOf(clock, moveTimeLimit).filter(homepagePoolIds)
