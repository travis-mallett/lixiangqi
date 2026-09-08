package lila.user

import chess.ByColor

import lila.core.perf.UserWithPerfs
import lila.db.dsl.*
import lila.rating.PerfType

/** Compatibility boundary for callers that used to maintain speed-specific Glicko leaderboards. Competitive
  * Xiangqi standings now live in [[XiangqiRankingApi]], so this service deliberately performs no writes.
  * Removal remains available for account-erasure and moderation workflows until the retired `ranking`
  * collection has been removed from every deployment.
  */
final class RankingApi(c: lila.db.AsyncCollFailingSilently)(using Executor)
    extends lila.core.user.RankingRepo(c):

  def save(
      @annotation.unused users: ByColor[UserWithPerfs],
      @annotation.unused perfType: PerfType
  ): Funit = funit

  def save(
      @annotation.unused user: User,
      @annotation.unused perfType: PerfType,
      @annotation.unused perf: Perf
  ): Funit = funit

  def remove(userId: UserId): Funit =
    coll:
      _.delete.one($doc("_id".$startsWith(s"$userId:"))).void
