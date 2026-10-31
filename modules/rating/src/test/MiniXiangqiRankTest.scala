package lila.rating

import chess.{ Color, Outcome }
import munit.FunSuite
import lila.core.rank.{ RankCode, RankScore, RankTrackId }

class MiniXiangqiRankTest extends FunSuite:
  test("all Mini Xiangqi titles and thresholds mirror Jieqi, including 迷9-4"):
    val levels = MiniXiangqiRank.catalog.levels
    assertEquals(levels.size, 28)
    levels.zipWithIndex.foreach: (level, index) =>
      assertEquals(
        level.code,
        RankCode(if index == 27 then "迷9-4" else s"迷${index / 3 + 1}-${index % 3 + 1}")
      )
      assertEquals(level.threshold, JieqiRank.catalog.levels(index).threshold)
      assertEquals(MiniXiangqiRank.catalog.level(level.threshold).code, level.code)
    assertEquals(MiniXiangqiRank.initialSnapshot.track, RankTrackId.minixiangqi)
    assertEquals(MiniXiangqiRank.initial.score, RankScore(0))
    assertEquals(MiniXiangqiRank.catalog.clamp(RankScore(-100)), RankScore(-30))

  test("every rank pairing and outcome settles exactly like Jieqi, on independent accounts"):
    for
      red <- MiniXiangqiRank.catalog.levels
      black <- MiniXiangqiRank.catalog.levels
      winner <- List(None, Some(Color.White), Some(Color.Black))
    do
      val mini =
        MiniXiangqiRank.settle(red.threshold, black.threshold, Outcome(winner)).map(s => s.red -> s.black)
      val jieqi = JieqiRank.settle(red.threshold, black.threshold, Outcome(winner)).map(s => s.red -> s.black)
      assertEquals(mini, jieqi)
    assert(
      MiniXiangqiRank.settle(MiniXiangqiRank.initialSnapshot, JieqiRank.initialSnapshot, Outcome(None)).isLeft
    )
    assertEquals(RankPolicy(RankTrackId.minixiangqi), MiniXiangqiRank)
