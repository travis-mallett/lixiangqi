package lila.rating

import lila.core.rank.{ RankCode, RankScore, RankTrackId }

/** Tiantian's in-app Jieqi table, supplied with the implementation request. */
object JieqiRank extends RankPolicy:
  private val thresholds = Vector(
    -30, 10, 20, 30, 40, 60, 80, 100, 120, 150, 180, 210, 240, 290, 340, 400, 460, 530, 600, 680, 760, 850,
    960, 1080, 1200, 1350, 1600, 10000
  )
  val catalog = RankCatalog(
    RankTrackId.jieqi,
    catalogVersion,
    RankScore(0),
    RankScore(-30),
    thresholds.zipWithIndex.map: (score, ordinal) =>
      val code = if ordinal == 27 then "揭9-4" else s"揭${ordinal / 3 + 1}-${ordinal % 3 + 1}"
      RankLevel(RankCode(code), RankScore(score), ordinal)
  )
  override protected def matchingGroup(ordinal: Int): Int = ordinal.min(26) / 3
