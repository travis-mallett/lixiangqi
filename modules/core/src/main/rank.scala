package lila.core

object rank:

  /** Stable identifier for an independently scored competitive discipline. */
  opaque type RankTrackId = String
  object RankTrackId extends OpaqueString[RankTrackId]:
    val xiangqi: RankTrackId = "xiangqi"

    val all: List[RankTrackId] = List(xiangqi)

    def from(value: String): Option[RankTrackId] = all.find(_.value == value)

  /** Internal assessment points. Public surfaces normally render a rank title instead. */
  opaque type RankScore = Int
  object RankScore extends OpaqueInt[RankScore]:
    extension (score: RankScore)
      def +(delta: RankDiff): RankScore = RankScore(score.value + delta.value)
      def atLeast(floor: RankScore): RankScore = RankScore(score.value.max(floor.value))

  opaque type RankDiff = Int
  object RankDiff extends OpaqueInt[RankDiff]:
    val zero: RankDiff = RankDiff(0)

    extension (diff: RankDiff) def unary_- : RankDiff = RankDiff(-diff.value)

  opaque type RankCode = String
  object RankCode extends OpaqueString[RankCode]

  /** The applied point change for one completed game, retained for retry-safe settlement. */
  case class RankSettlement(gameId: lila.core.id.GameId, diff: RankDiff)

  /** A user's state in one competitive track. A missing track is unranked; this value only exists after a
    * track has been initialized for a ranked game.
    */
  case class RankPerf(
      score: RankScore,
      games: Int,
      wins: Int,
      draws: Int,
      losses: Int,
      recent: List[RankScore],
      latest: Option[Instant],
      catalogVersion: Int,
      policyVersion: Int,
      settlements: List[RankSettlement] = Nil,
      restoredGames: List[lila.core.id.GameId] = Nil
  ):
    def established: Boolean = games > 0
    def settlement(gameId: lila.core.id.GameId): Option[RankDiff] =
      settlements.find(_.gameId == gameId).map(_.diff)
    def hasSettled(gameId: lila.core.id.GameId): Boolean = settlement(gameId).isDefined
    def hasRestored(gameId: lila.core.id.GameId): Boolean = restoredGames.contains(gameId)

    def progress: RankDiff =
      import RankScore.*
      recent.headOption
        .zip(recent.lastOption)
        .fold(RankDiff.zero): (head, last) =>
          RankDiff(head.value - last.value)

  case class KeyedRankPerf(track: RankTrackId, perf: RankPerf)

  /** Private point movement plus the public rank title after settlement. */
  case class RankChange(diff: RankDiff, rank: RankCode)

  /** Immutable rank information captured when a game is created. Settlement policy uses these snapshots, not
    * mutable profile state, so concurrent games cannot change what a result is worth. The rendered code plus
    * catalog and settlement-policy versions are retained to keep historical games intelligible and
    * deterministic if a future variant revises its rank system.
    */
  case class RankSnapshot(
      track: RankTrackId,
      score: RankScore,
      code: RankCode,
      ordinal: Int,
      catalogVersion: Int,
      policyVersion: Int,
      established: Boolean,
      diff: Option[RankDiff] = None,
      after: Option[RankCode] = None
  ):
    def scoreAfter: Option[RankScore] = diff.map(score + _)
    def publicCode: Option[RankCode] = after.orElse(established.option(code))
