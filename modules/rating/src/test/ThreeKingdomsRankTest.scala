package lila.rating

import lila.core.rank.{ RankDiff, RankScore, RankTrackId }

class ThreeKingdomsRankTest extends munit.FunSuite:
  private val players = Vector.fill(3)(ThreeKingdomsRank.initialSnapshot)

  test("three placements settle exactly three pairwise comparisons"):
    assertEquals(
      ThreeKingdomsRank.settleThree(players, Vector(1d, 2d, 3d)),
      Right(Vector(RankDiff(20), RankDiff(0), RankDiff(-20)))
    )
    assertEquals(
      ThreeKingdomsRank.settleThree(players, Vector(3d, 1d, 2d)),
      Right(Vector(RankDiff(-20), RankDiff(20), RankDiff(0)))
    )

  test("a drawn final duel preserves the first elimination's loss"):
    assertEquals(
      ThreeKingdomsRank.settleThree(players, Vector(1.5d, 1.5d, 3d)),
      Right(Vector(RankDiff(10), RankDiff(10), RankDiff(-20)))
    )
    assertEquals(
      ThreeKingdomsRank.settleThree(players, Vector(2d, 2d, 2d)),
      Right(Vector.fill(3)(RankDiff(0)))
    )

  test("the track is independent and malformed rankings cannot settle"):
    assertEquals(ThreeKingdomsRank.initialSnapshot.track, RankTrackId.threeKingdoms)
    assert(ThreeKingdomsRank.settleThree(players, Vector(1d, 1d, 3d)).isLeft)
    assert(ThreeKingdomsRank.settleThree(players.take(2), Vector(1d, 2d, 3d)).isLeft)
    assert(
      ThreeKingdomsRank.settleThree(players.updated(0, JieqiRank.initialSnapshot), Vector(1d, 2d, 3d)).isLeft
    )
