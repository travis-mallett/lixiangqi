package lila.pool

import scala.math.abs
import scalalib.WMMatching

import lila.core.pool.PoolMember
import lila.core.rank.RankScore.*

object MatchMaking:

  case class Couple(p1: PoolMember, p2: PoolMember):
    def members = Vector(p1, p2)
    def userIds = members.map(_.userId)
    def rankDistance = p1.rankDistance(p2)

  def apply(members: Vector[PoolMember]): Vector[Couple] =
    val (lames, fairs) = members.partition(_.lame)
    greedy(lames) ++ (wmMatching(fairs) | greedy(fairs))

  /** Deterministic fallback that observes the same eligibility rules as weighted matching. */
  private def greedy(members: Vector[PoolMember]): Vector[Couple] =
    def loop(rest: Vector[PoolMember], pairs: Vector[Couple]): Vector[Couple] =
      rest.headOption.fold(pairs): first =>
        val partnerIndex = rest.indexWhere(other => pairScore(first, other).isDefined, from = 1)
        if partnerIndex < 0 then loop(rest.tail, pairs)
        else
          val partner = rest(partnerIndex)
          loop(rest.tail.patch(partnerIndex - 1, Nil, 1), pairs :+ Couple(first, partner))
    loop(members.sortBy(m => (m.rank.ordinal, m.rank.score.value)), Vector.empty)

  /** Same-rank pairings are preferred and adjacent-rank pairings are permitted. More distant pairings are
    * forbidden because the authentic assessment policy defines no result value for them.
    */
  private def pairScore(a: PoolMember, b: PoolMember): Option[Int] =
    val distance = a.rankDistance(b)
    val conflict =
      a.userId == b.userId ||
        a.rank.track != b.rank.track ||
        a.rank.catalogVersion != b.rank.catalogVersion ||
        a.rank.policyVersion != b.rank.policyVersion ||
        distance > 1 ||
        blockList(a, b) ||
        blockList(b, a)
    if conflict then none
    else
      val score =
        distance * 1000 + a.scoreDistance(b).min(500)
          - missBonus(a).atMost(missBonus(b))
          - rageSitBonus(a, b)
      score.some

  private def missBonus(p: PoolMember) =
    math.max(0, math.min(p.misses * 12, 460 + math.min(p.rageSitCounter, -3) * 20))

  private def blockList(a: PoolMember, b: PoolMember): Boolean =
    a.blocking.value contains b.userId

  private def rageSitBonus(a: PoolMember, b: PoolMember) =
    if a.rageSitCounter >= -2 && b.rageSitCounter >= -2 then 30
    else if a.rageSitCounter <= -12 && b.rageSitCounter <= -12 then 60
    else if a.rageSitCounter <= -5 && b.rageSitCounter <= -5 then 30
    else abs(a.rageSitCounter - b.rageSitCounter).atMost(10) * -20

  private object wmMatching:
    def apply(members: Vector[PoolMember]): Option[Vector[Couple]] =
      WMMatching(members.toArray, pairScore).fold(
        err =>
          logger.error("WMMatching", err)
          none
        ,
        _.map(Couple.apply).toVector.some
      )
