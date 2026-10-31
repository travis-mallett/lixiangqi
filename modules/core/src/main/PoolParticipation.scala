package lila.core.pool

import lila.core.id.GameId
import lila.core.userId.UserId

/** One in-process matchmaking authority shared by the two-seat and three-seat pools. Reservations close the
  * asynchronous gap between selecting opponents and inserting a game. The persisted game remains
  * authoritative after a restart.
  */
final class PoolParticipation:
  private case class Entry(room: String, game: Option[GameId], expires: Long)
  private val entries = scala.collection.mutable.Map.empty[UserId, Entry]
  private def prune(now: Long): Unit = entries.filterInPlace((_, e) => e.expires > now)

  def join(user: UserId, room: String, now: Long): Boolean = synchronized:
    prune(now)
    if entries.get(user).exists(_.game.nonEmpty) then false
    else
      entries.update(user, Entry(room, None, now + 30 * 60 * 1000L))
      true

  def leave(user: UserId, room: String): Unit = synchronized:
    if entries.get(user).exists(e => e.room == room && e.game.isEmpty) then entries.remove(user)

  def reserve(
      room: String,
      users: List[UserId],
      game: GameId,
      now: Long,
      unqueued: Set[UserId] = Set.empty
  ): Boolean = synchronized:
    prune(now)
    val available = users.distinct.size == users.size && users.forall: user =>
      entries.get(user).fold(unqueued.contains(user))(e => e.room == room && e.game.isEmpty)
    if available then
      users.foreach(user => entries.update(user, Entry(room, Some(game), now + 3 * 60 * 60 * 1000L)))
    available

  def release(game: GameId, users: Iterable[UserId]): Unit = synchronized:
    users.foreach: user =>
      if entries.get(user).exists(_.game.contains(game)) then entries.remove(user)
