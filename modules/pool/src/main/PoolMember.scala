package lila.pool

import lila.core.pool.PoolMember
import lila.core.rank.RankScore.*

extension (m: PoolMember)
  def incMisses = m.copy(misses = m.misses + 1)
  def rankDistance(other: PoolMember): Int = math.abs(m.rank.matchingGroup - other.rank.matchingGroup)
  def scoreDistance(other: PoolMember): Int = math.abs(m.rank.score.value - other.rank.score.value)
