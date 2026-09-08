package lila.rating

import chess.Outcome

import lila.core.rank.{ RankCode, RankDiff, RankPerf, RankScore, RankSettlement, RankSnapshot, RankTrackId }
import lila.core.rank.RankDiff.*
import lila.core.rank.RankScore.*
import lila.core.rank.RankTrackId.*

case class RankLevel(code: RankCode, threshold: RankScore, ordinal: Int)

case class RankCatalog(
    track: RankTrackId,
    version: Int,
    initialScore: RankScore,
    floor: RankScore,
    levels: Vector[RankLevel]
):
  require(levels.nonEmpty, "A rank catalog must contain at least one level")
  require(
    levels.map(_.threshold.value).sliding(2).forall {
      case Seq(a, b) => a < b
      case _ => true
    },
    "Rank thresholds must be strictly increasing"
  )
  require(levels.map(_.ordinal) == levels.indices, "Rank ordinals must be contiguous")
  require(levels.map(_.code).distinct.size == levels.size, "Rank codes must be unique")
  require(levels.head.threshold == floor, "The first rank threshold must equal the score floor")
  require(initialScore.value >= floor.value, "The initial score must not be below the score floor")

  def level(score: RankScore): RankLevel =
    levels.reverseIterator.find(_.threshold.value <= score.value).getOrElse(levels.head)

  def code(score: RankScore): RankCode = level(score).code

  def clamp(score: RankScore): RankScore = score.atLeast(floor)

object XiangqiRank:

  val firstCatalogVersion = 1
  val firstPolicyVersion = 1
  val catalogVersion = firstCatalogVersion
  val policyVersion = firstPolicyVersion

  private val thresholds: Vector[(String, Int)] = Vector(
    "学1-1" -> -250,
    "学1-2" -> -200,
    "学1-3" -> -160,
    "学2-1" -> -120,
    "学2-2" -> -80,
    "学2-3" -> -50,
    "学3-1" -> -30,
    "学3-2" -> -20,
    "学3-3" -> -10,
    "业1-1" -> 0,
    "业1-2" -> 10,
    "业1-3" -> 20,
    "业2-1" -> 30,
    "业2-2" -> 40,
    "业2-3" -> 60,
    "业3-1" -> 80,
    "业3-2" -> 100,
    "业3-3" -> 120,
    "业4-1" -> 150,
    "业4-2" -> 180,
    "业4-3" -> 210,
    "业5-1" -> 240,
    "业5-2" -> 290,
    "业5-3" -> 340,
    "业6-1" -> 400,
    "业6-2" -> 460,
    "业6-3" -> 530,
    "业7-1" -> 600,
    "业7-2" -> 680,
    "业7-3" -> 760,
    "业8-1" -> 850,
    "业8-2" -> 960,
    "业8-3" -> 1080,
    "业9-1" -> 1200,
    "业9-2" -> 1500,
    "业9-3" -> 1800,
    "专1-1" -> 2100,
    "专1-2" -> 2500,
    "专1-3" -> 3000,
    "专2-1" -> 3500,
    "专2-2" -> 4000,
    "专2-3" -> 4500,
    "专3-1" -> 5000,
    "专3-2" -> 6000,
    "专3-3" -> 7000
  )

  val catalog = RankCatalog(
    track = RankTrackId.xiangqi,
    version = catalogVersion,
    initialScore = RankScore(-160),
    floor = RankScore(-250),
    levels = thresholds.zipWithIndex.map { case ((code, score), ordinal) =>
      RankLevel(RankCode(code), RankScore(score), ordinal)
    }
  )

  val initial = RankPerf(
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
      Left("Game rank snapshots do not belong to the Xiangqi track")
    else if red.catalogVersion != black.catalogVersion then
      Left("Game rank snapshots use different catalog versions")
    else if red.policyVersion != black.policyVersion then
      Left("Game rank snapshots use different settlement policy versions")
    else
      (red.catalogVersion, red.policyVersion) match
        // Keep this branch when a future catalog or policy is introduced so unfinished historical
        // games are always settled by the rules captured when they were created.
        case (`catalogVersion`, `policyVersion`) => settleOrdinals(red.ordinal, black.ordinal, outcome)
        case versions => Left(s"Unsupported Xiangqi rank snapshot versions: $versions")

  private def settleOrdinals(
      redOrdinal: Int,
      blackOrdinal: Int,
      outcome: Outcome
  ): Either[String, Settlement] =
    val distance = (redOrdinal - blackOrdinal).abs
    if distance > 1 then Left(s"Rated players must be in the same or adjacent ranks (distance $distance)")
    else if outcome.winner.isEmpty then Right(Settlement(RankDiff.zero, RankDiff.zero))
    else
      val redWon = outcome.winner.contains(chess.Color.White)
      val redDelta =
        if distance == 0 then RankDiff(if redWon then 10 else -10)
        else
          val redIsLower = redOrdinal < blackOrdinal
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
