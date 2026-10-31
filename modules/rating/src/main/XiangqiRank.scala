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

object XiangqiRank extends RankPolicy:

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
