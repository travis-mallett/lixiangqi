package lila.rating

import chess.{ Color, Outcome }
import munit.FunSuite
import lila.core.rank.{ RankCode, RankDiff, RankScore, RankTrackId }
import lila.core.rank.RankDiff.*

class JieqiRankTest extends FunSuite:
  test("every supplied threshold, initial score, floor and final title"):
    val expected = Vector(-30, 10, 20, 30, 40, 60, 80, 100, 120, 150, 180, 210, 240, 290, 340, 400, 460, 530,
      600, 680, 760, 850, 960, 1080, 1200, 1350, 1600, 10000)
    assertEquals(JieqiRank.catalog.levels.map(_.threshold.value), expected)
    expected.zipWithIndex.foreach: (score, index) =>
      val title = if index == 27 then "揭9-4" else s"揭${index / 3 + 1}-${index % 3 + 1}"
      assertEquals(JieqiRank.catalog.level(RankScore(score)).code, RankCode(title))
      if index > 0 then
        assertEquals(
          JieqiRank.catalog.level(RankScore(score - 1)).code,
          JieqiRank.catalog.levels(index - 1).code
        )
    assertEquals(JieqiRank.initial.score, RankScore(0))
    assertEquals(JieqiRank.catalog.clamp(RankScore(-100)), RankScore(-30))

  private def delta(red: Int, black: Int, winner: Option[Color]) =
    JieqiRank.settle(RankScore(red), RankScore(black), Outcome(winner)).map(s => s.red.value -> s.black.value)

  test("major rank groups determine settlement, including the fourth top subrank"):
    assertEquals(delta(0, 20, Some(Color.White)), Right(10 -> -10))
    assertEquals(delta(20, 30, Some(Color.White)), Right(15 -> -15))
    assertEquals(delta(20, 30, Some(Color.Black)), Right(-5 -> 5))
    assertEquals(delta(1600, 10000, Some(Color.White)), Right(10 -> -10))
    assertEquals(delta(20, 30, None), Right(0 -> 0))
    assert(delta(0, 80, Some(Color.White)).isLeft)

  test("Jieqi settlement is independent of Xiangqi and idempotent per game"):
    assertEquals(JieqiRank.initialSnapshot.track, RankTrackId.jieqi)
    assert(
      JieqiRank
        .settle(JieqiRank.initialSnapshot, XiangqiRank.initialSnapshot, Outcome(Some(Color.White)))
        .isLeft
    )
    val at = nowInstant
    val id = GameId("jieqi001")
    val once = JieqiRank.applyResult(JieqiRank.initial, RankDiff(10), true, false, at, id)
    val twice = JieqiRank.applyResult(once, RankDiff(10), true, false, at, id)
    assertEquals(twice, once)
    assertEquals(once.score, RankScore(10))
