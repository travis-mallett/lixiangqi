package lila.lobby

import lila.core.socket.Sri

private[lobby] final class PuzzlePlayerRegistry:

  private case class Entry(userId: Option[UserId], seenAt: Long)

  private var entries = Map.empty[Sri, Entry]

  def count: Int =
    entries.iterator
      .map: (sri, entry) =>
        entry.userId.fold(s"s:${sri.value}")(userId => s"u:${userId.value}")
      .toSet
      .size

  def enter(sri: Sri, userId: Option[UserId], at: Long): Option[Int] =
    update(entries.updated(sri, Entry(userId, at)))

  def expire(before: Long): Option[Int] =
    update(entries.filter((_, entry) => entry.seenAt >= before))

  def clear(): Option[Int] = update(Map.empty)

  private def update(next: Map[Sri, Entry]): Option[Int] =
    val previousCount = count
    entries = next
    val nextCount = count
    Option.when(previousCount != nextCount)(nextCount)
