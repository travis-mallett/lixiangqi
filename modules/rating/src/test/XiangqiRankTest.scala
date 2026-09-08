package lila.rating

import chess.{ Color, Outcome }
import munit.FunSuite

import lila.core.rank.{ RankCode, RankScore }
import lila.core.rank.RankDiff.*

class XiangqiRankTest extends FunSuite:

  test("complete authoritative rank catalog"):
    val expected = Vector(
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
    assertEquals(
      XiangqiRank.catalog.levels.map(level => level.code.value -> level.threshold.value),
      expected
    )

  test("authoritative rank thresholds"):
    assertEquals(XiangqiRank.catalog.level(RankScore(-999)).code, RankCode("学1-1"))
    assertEquals(XiangqiRank.catalog.level(RankScore(-250)).code, RankCode("学1-1"))
    assertEquals(XiangqiRank.catalog.level(RankScore(-201)).code, RankCode("学1-1"))
    assertEquals(XiangqiRank.catalog.level(RankScore(-200)).code, RankCode("学1-2"))
    assertEquals(XiangqiRank.catalog.level(RankScore(-160)).code, RankCode("学1-3"))
    assertEquals(XiangqiRank.catalog.level(RankScore(0)).code, RankCode("业1-1"))
    assertEquals(XiangqiRank.catalog.level(RankScore(1200)).code, RankCode("业9-1"))
    assertEquals(XiangqiRank.catalog.level(RankScore(7000)).code, RankCode("专3-3"))
    assertEquals(XiangqiRank.catalog.level(RankScore(99999)).code, RankCode("专3-3"))

  test("authoritative initial score and floor"):
    assertEquals(XiangqiRank.catalogVersion, XiangqiRank.firstCatalogVersion)
    assertEquals(XiangqiRank.policyVersion, XiangqiRank.firstPolicyVersion)
    assertEquals(XiangqiRank.initial.score, RankScore(-160))
    assertEquals(XiangqiRank.catalog.clamp(RankScore(-260)), RankScore(-250))

  test("the internal starting snapshot remains publicly unranked"):
    assertEquals(XiangqiRank.initialSnapshot.catalogVersion, XiangqiRank.catalogVersion)
    assertEquals(XiangqiRank.initialSnapshot.policyVersion, XiangqiRank.policyVersion)
    assertEquals(XiangqiRank.initialSnapshot.publicCode, None)
    val established = XiangqiRank.applyResult(
      XiangqiRank.initial,
      lila.core.rank.RankDiff.zero,
      won = false,
      drawn = true,
      at = nowInstant
    )
    assertEquals(XiangqiRank.snapshot(established).publicCode, RankCode("学1-3").some)

  test("puzzle Glicko has no dependency on native Xiangqi rank"):
    assert(!UserPerfs.dubiousPuzzle(UserPerfs.default(UserId("puzzleonly"))))

  test("a completed first game exposes its persisted post-game rank"):
    val completed = XiangqiRank.initialSnapshot.copy(
      diff = lila.core.rank.RankDiff(10).some,
      after = RankCode("学1-3").some
    )
    assertEquals(completed.publicCode, RankCode("学1-3").some)

  test("a loss at the floor cannot reduce the score"):
    val next = XiangqiRank.applyResult(
      XiangqiRank.initial.copy(score = RankScore(-250)),
      lila.core.rank.RankDiff(-10),
      won = false,
      drawn = false,
      at = nowInstant
    )
    assertEquals(next.score, RankScore(-250))

  test("same-rank game moves ten points"):
    assertEquals(
      XiangqiRank
        .settle(RankScore(0), RankScore(5), Outcome(Color.White.some))
        .map(s => s.red.value -> s.black.value),
      Right(10 -> -10)
    )

  test("adjacent-rank upset moves fifteen points"):
    assertEquals(
      XiangqiRank
        .settle(RankScore(-1), RankScore(0), Outcome(Color.White.some))
        .map(s => s.red.value -> s.black.value),
      Right(15 -> -15)
    )

  test("adjacent-rank favorite win moves five points"):
    assertEquals(
      XiangqiRank
        .settle(RankScore(0), RankScore(-1), Outcome(Color.White.some))
        .map(s => s.red.value -> s.black.value),
      Right(5 -> -5)
    )

  test("adjacent-rank black upset moves fifteen points"):
    assertEquals(
      XiangqiRank
        .settle(RankScore(0), RankScore(-1), Outcome(Color.Black.some))
        .map(s => s.red.value -> s.black.value),
      Right(-15 -> 15)
    )

  test("adjacent-rank black favorite win moves five points"):
    assertEquals(
      XiangqiRank
        .settle(RankScore(-1), RankScore(0), Outcome(Color.Black.some))
        .map(s => s.red.value -> s.black.value),
      Right(-5 -> 5)
    )

  test("draw does not move either score"):
    assertEquals(
      XiangqiRank.settle(RankScore(0), RankScore(10), Outcome(None)).map(s => s.red.value -> s.black.value),
      Right(0 -> 0)
    )

  test("ranked settlement rejects ranks more than one level apart"):
    assert(XiangqiRank.settle(RankScore(-250), RankScore(0), Outcome(Color.White.some)).isLeft)

  test("persisted games cannot mix or silently reinterpret policy versions"):
    val current = XiangqiRank.initialSnapshot
    assert(XiangqiRank.settle(current, current.copy(policyVersion = 2), Outcome(Color.White.some)).isLeft)
    assert(
      XiangqiRank
        .settle(current.copy(policyVersion = 2), current.copy(policyVersion = 2), Outcome(Color.White.some))
        .isLeft
    )

  test("a game result is applied at most once to one rank account"):
    val gameId = GameId("abcdefgh")
    val once = XiangqiRank.applyResult(
      XiangqiRank.initial,
      lila.core.rank.RankDiff(10),
      won = true,
      drawn = false,
      at = nowInstant,
      gameId = gameId
    )
    val twice = XiangqiRank.applyResult(
      once,
      lila.core.rank.RankDiff(10),
      won = true,
      drawn = false,
      at = nowInstant,
      gameId = gameId
    )
    assertEquals(twice, once)
    assertEquals(once.settlement(gameId), lila.core.rank.RankDiff(10).some)

  test("the settlement ledger records the applied floor-clamped change"):
    val gameId = GameId("floor001")
    val next = XiangqiRank.applyResult(
      XiangqiRank.initial.copy(score = RankScore(-250)),
      lila.core.rank.RankDiff(-10),
      won = false,
      drawn = false,
      at = nowInstant,
      gameId = gameId
    )
    assertEquals(next.settlement(gameId), lila.core.rank.RankDiff.zero.some)

  test("restoring points changes score without fabricating a game"):
    val established = XiangqiRank.applyResult(
      XiangqiRank.initial,
      lila.core.rank.RankDiff(-10),
      won = false,
      drawn = false,
      at = nowInstant
    )
    val restored = XiangqiRank.restore(established, lila.core.rank.RankDiff(10))
    assertEquals(restored.score, XiangqiRank.initial.score)
    assertEquals(restored.games, established.games)
    assertEquals(restored.latest, established.latest)

  test("fair-play restoration is idempotent per game"):
    val gameId = GameId("refund01")
    val (once, firstPoints) = XiangqiRank.restoreLosses(
      XiangqiRank.initial,
      List(gameId -> lila.core.rank.RankDiff(10), gameId -> lila.core.rank.RankDiff(10))
    )
    val (twice, secondPoints) = XiangqiRank.restoreLosses(
      once,
      List(gameId -> lila.core.rank.RankDiff(10))
    )
    assertEquals(firstPoints, lila.core.rank.RankDiff(10))
    assertEquals(secondPoints, lila.core.rank.RankDiff.zero)
    assertEquals(twice, once)
