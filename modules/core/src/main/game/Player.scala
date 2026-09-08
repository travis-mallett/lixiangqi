package lila.core
package game

import _root_.chess.{ Color, PlayerName, Ply, IntRating }
import _root_.chess.rating.{ IntRatingDiff, RatingProvisional }
import cats.kernel.Eq

import lila.core.id.GamePlayerId
import lila.core.perf.Perf
import lila.core.rank.RankSnapshot
import lila.core.rank.RankScore.*
import lila.core.user.WithPerf
import lila.core.userId.{ UserId, UserIdOf }

case class Player(
    id: GamePlayerId,
    color: Color,
    aiLevel: Option[Int],
    isWinner: Option[Boolean] = None,
    isOfferingDraw: Boolean = false,
    proposeTakebackAt: Ply = Ply.initial, // ply when takeback was proposed
    userId: Option[UserId] = None,
    rank: Option[RankSnapshot] = None,
    rating: Option[IntRating] = None,
    ratingDiff: Option[IntRatingDiff] = None,
    provisional: RatingProvisional = RatingProvisional.No,
    blurs: Blurs = Blurs(0L),
    berserk: Boolean = false,
    blindfold: Boolean = false,
    name: Option[PlayerName] = None
):
  def isAi = aiLevel.isDefined

  def hasUser = userId.isDefined

  def isUser[U: UserIdOf](u: U) = userId.has(u.id)

  def removeTakebackProposition = copy(proposeTakebackAt = Ply.initial)

  def isProposingTakeback = proposeTakebackAt > 0

  def before(other: Player) =
    ((rank.map(_.score.value), rating, id), (other.rank.map(_.score.value), other.rating, other.id)) match
      case ((Some(a), _, _), (Some(b), _, _)) if a != b => a > b
      case ((Some(_), _, _), (None, _, _)) => true
      case ((None, _, _), (Some(_), _, _)) => false
      case ((_, Some(a), _), (_, Some(b), _)) if a != b => a.value > b.value
      case ((_, Some(_), _), (_, None, _)) => true
      case ((_, None, _), (_, Some(_), _)) => false
      case ((_, _, a), (_, _, b)) => a.value < b.value

  def rankAfter = rank.flatMap(_.scoreAfter)

  def ratingAfter = for
    r <- rating
    d <- ratingDiff
  yield r.map(_ + d.value)

  def stableRating = rating.ifFalse(provisional.value)

  def stableRatingAfter = for
    r <- stableRating
    d <- ratingDiff
  yield r.map(_ + d.value)

  def light = LightPlayer(color, aiLevel, userId, rank, rating, ratingDiff, provisional, berserk)

object Player:
  given Eq[Player] = Eq.by(p => (p.id, p.userId))

trait NewPlayer:
  def apply(color: Color, user: Option[WithPerf]): Player
  def apply(color: Color, userId: UserId, rank: RankSnapshot): Player
  def apply(color: Color, userId: UserId, rating: IntRating, provisional: RatingProvisional): Player
  def apply(color: Color, userPerf: (UserId, Perf)): Player
  def anon(color: Color, aiLevel: Option[Int] = None): Player
