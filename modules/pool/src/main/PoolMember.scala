package lila.pool

import lila.core.pool.PoolMember
import lila.core.rank.RankScore.*

extension (m: PoolMember)
  def incMisses = m.copy(misses = m.misses + 1)
  def rankDistance(other: PoolMember): Int = math.abs(m.rank.ordinal - other.rank.ordinal)
  def scoreDistance(other: PoolMember): Int = math.abs(m.rank.score.value - other.rank.score.value)
