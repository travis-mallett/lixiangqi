package lila.rating

import chess.Outcome

import lila.core.rank.{ RankCode, RankDiff, RankPerf, RankScore, RankSettlement, RankSnapshot, RankTrackId }
import lila.core.rank.RankDiff.*
import lila.core.rank.RankScore.*
import lila.core.rank.RankTrackId.*

object RankPolicy:
  def apply(track: RankTrackId): RankPolicy =
    if track == RankTrackId.jieqi then JieqiRank
    else if track == RankTrackId.minixiangqi then MiniXiangqiRank
    else if track == RankTrackId.threeKingdoms then ThreeKingdomsRank
    else XiangqiRank

/** Shared settlement, snapshots and recovery for independently catalogued disciplines. */
abstract class RankPolicy:
  val catalog: RankCatalog
  protected def matchingGroup(ordinal: Int): Int = ordinal
  val firstCatalogVersion = 1
  val firstPolicyVersion = 1
  val catalogVersion = firstCatalogVersion
  val policyVersion = firstPolicyVersion

  lazy val initial = RankPerf(
    score = catalog.initialScore,
    games = 0,
    wins = 0,
    draws = 0,
    losses = 0,
    recent = Nil,
    latest = None,
    catalogVersion = catalogVersion,
    policyVersion = policyVersion
  )

  case class Settlement(red: RankDiff, black: RankDiff)

  def snapshot(perf: RankPerf): RankSnapshot =
    val level = catalog.level(perf.score)
    RankSnapshot(
      track = catalog.track,
      score = perf.score,
      code = level.code,
      ordinal = level.ordinal,
      catalogVersion = catalogVersion,
      policyVersion = policyVersion,
      established = perf.established
    )

  /** Starting snapshot used by non-ranked surfaces before a player establishes a rank. */
  lazy val initialSnapshot: RankSnapshot = snapshot(initial)

  /** Compute a zero-sum result from immutable game-start ranks. */
  def settle(redScore: RankScore, blackScore: RankScore, outcome: Outcome): Either[String, Settlement] =
    settleOrdinals(catalog.level(redScore).ordinal, catalog.level(blackScore).ordinal, outcome)

  /** Settle a persisted game without reinterpreting it through a newer catalog. */
  def settle(red: RankSnapshot, black: RankSnapshot, outcome: Outcome): Either[String, Settlement] =
    if red.track != catalog.track || black.track != catalog.track then
      Left("Game rank snapshots do not belong to the requested rank track")
    else if red.catalogVersion != black.catalogVersion then
      Left("Game rank snapshots use different catalog versions")
    else if red.policyVersion != black.policyVersion then
      Left("Game rank snapshots use different settlement policy versions")
    else
      (red.catalogVersion, red.policyVersion) match
        // Keep this branch when a future catalog or policy is introduced so unfinished historical
        // games are always settled by the rules captured when they were created.
        case (`catalogVersion`, `policyVersion`) => settleOrdinals(red.ordinal, black.ordinal, outcome)
        case versions => Left(s"Unsupported native rank snapshot versions: $versions")

  private def settleOrdinals(
      redOrdinal: Int,
      blackOrdinal: Int,
      outcome: Outcome
  ): Either[String, Settlement] =
    val redGroup = matchingGroup(redOrdinal)
    val blackGroup = matchingGroup(blackOrdinal)
    val distance = (redGroup - blackGroup).abs
    if distance > 1 then Left(s"Rated players must be in the same or adjacent ranks (distance $distance)")
    else if outcome.winner.isEmpty then Right(Settlement(RankDiff.zero, RankDiff.zero))
    else
      val redWon = outcome.winner.contains(chess.Color.White)
      val redDelta =
        if distance == 0 then RankDiff(if redWon then 10 else -10)
        else
          val redIsLower = redGroup < blackGroup
          val winnerIsLower = if redWon then redIsLower else !redIsLower
          val winnerDelta = if winnerIsLower then 15 else 5
          RankDiff(if redWon then winnerDelta else -winnerDelta)
      Right(Settlement(redDelta, -redDelta))

  def applyResult(perf: RankPerf, delta: RankDiff, won: Boolean, drawn: Boolean, at: Instant): RankPerf =
    val nextScore = catalog.clamp(perf.score + delta)
    perf.copy(
      score = nextScore,
      games = perf.games + 1,
      wins = perf.wins + won.so(1),
      draws = perf.draws + drawn.so(1),
      losses = perf.losses + (!won && !drawn).so(1),
      recent = (nextScore :: perf.recent).take(12),
      latest = at.some,
      catalogVersion = catalogVersion,
      policyVersion = policyVersion
    )

  def applyResult(
      perf: RankPerf,
      delta: RankDiff,
      won: Boolean,
      drawn: Boolean,
      at: Instant,
      gameId: GameId
  ): RankPerf =
    if perf.hasSettled(gameId) then perf
    else
      val next = applyResult(perf, delta, won, drawn, at)
      val applied = RankDiff(next.score.value - perf.score.value)
      next.copy(settlements = (RankSettlement(gameId, applied) :: perf.settlements).take(32))

  /** Restore native points without fabricating a game result or changing rank activity. */
  def restore(perf: RankPerf, points: RankDiff): RankPerf =
    require(points.value >= 0, "Restored Xiangqi rank points must be non-negative")
    val nextScore = catalog.clamp(perf.score + points)
    perf.copy(
      score = nextScore,
      recent = (nextScore :: perf.recent).take(12),
      catalogVersion = catalogVersion,
      policyVersion = policyVersion
    )

  /** Restore recorded losses exactly once per game. The bounded ledger covers substantially more than the
    * 40-game fair-play review window while avoiding unbounded account-document growth.
    */
  def restoreLosses(
      perf: RankPerf,
      losses: List[(GameId, RankDiff)]
  ): (RankPerf, RankDiff) =
    losses.foreach((_, points) =>
      require(points.value >= 0, "Restored Xiangqi rank points must be non-negative")
    )
    val fresh = losses.distinctBy(_._1).filterNot((gameId, _) => perf.hasRestored(gameId))
    val points = RankDiff(fresh.foldLeft(0)(_ + _._2.value))
    if fresh.isEmpty then perf -> RankDiff.zero
    else
      restore(perf, points).copy(
        restoredGames = (fresh.map(_._1) ::: perf.restoredGames).distinct.take(128)
      ) -> points
