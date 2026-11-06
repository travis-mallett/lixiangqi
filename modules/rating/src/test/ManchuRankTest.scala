package lila.rating

import chess.{ Color, Outcome }
import munit.FunSuite
import lila.core.rank.{ RankCode, RankScore, RankTrackId }

class ManchuRankTest extends FunSuite:
  test("all Manchu+ titles and thresholds mirror Jieqi, including 旗9-4"):
    val levels = ManchuRank.catalog.levels
    assertEquals(levels.size, 28)
    levels.zipWithIndex.foreach: (level, index) =>
      assertEquals(
        level.code,
        RankCode(if index == 27 then "旗9-4" else s"旗${index / 3 + 1}-${index % 3 + 1}")
      )
      assertEquals(level.threshold, JieqiRank.catalog.levels(index).threshold)
      assertEquals(ManchuRank.catalog.level(level.threshold).code, level.code)
    assertEquals(ManchuRank.initialSnapshot.track, RankTrackId.manchu)
    assertEquals(ManchuRank.initial.score, RankScore(0))
    assertEquals(ManchuRank.catalog.clamp(RankScore(-100)), RankScore(-30))

  test("every rank pairing and outcome settles exactly like Jieqi, on independent accounts"):
    for
      red <- ManchuRank.catalog.levels
      black <- ManchuRank.catalog.levels
      winner <- List(None, Some(Color.White), Some(Color.Black))
    do
      val mini =
        ManchuRank.settle(red.threshold, black.threshold, Outcome(winner)).map(s => s.red -> s.black)
      val jieqi = JieqiRank.settle(red.threshold, black.threshold, Outcome(winner)).map(s => s.red -> s.black)
      assertEquals(mini, jieqi)
    assert(
      ManchuRank.settle(ManchuRank.initialSnapshot, JieqiRank.initialSnapshot, Outcome(None)).isLeft
    )
    assertEquals(RankPolicy(RankTrackId.manchu), ManchuRank)
