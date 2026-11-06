package lila.rating

import lila.core.rank.{ RankCode, RankTrackId }
import lila.core.rank.RankCode.*

/** The shared variant ladder with independent Manchu+ scores. */
object ManchuRank extends RankPolicy:
  val catalog = JieqiRank.catalog.copy(
    track = RankTrackId.manchu,
    levels =
      JieqiRank.catalog.levels.map(level => level.copy(code = RankCode("旗" + level.code.value.drop(1))))
  )
  override protected def matchingGroup(ordinal: Int): Int = ordinal.min(26) / 3
