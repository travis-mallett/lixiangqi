package lila.rating

import lila.core.rank.{ RankCode, RankTrackId }
import lila.core.rank.RankCode.*

/** The Jieqi ladder and calculations, with independent Mini Xiangqi scores. */
object MiniXiangqiRank extends RankPolicy:
  val catalog = JieqiRank.catalog.copy(
    track = RankTrackId.minixiangqi,
    levels =
      JieqiRank.catalog.levels.map(level => level.copy(code = RankCode("迷" + level.code.value.drop(1))))
  )
  override protected def matchingGroup(ordinal: Int): Int = ordinal.min(26) / 3
