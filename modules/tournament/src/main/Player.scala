package lila.tournament

import scalalib.ThreadLocalRandom

import lila.core.LightUser
import lila.core.rank.{ RankCode, RankSnapshot }
import lila.core.rank.RankCode.*
import lila.core.user.WithPerf
import lila.rating.XiangqiRank

case class Player(
    _id: TourPlayerId, // random
    tourId: TourId,
    userId: UserId,
    rank: RankSnapshot,
    withdraw: Boolean = false,
    score: Int = 0,
    fire: Boolean = false,
    team: Option[TeamId] = None,
    bot: Boolean = false
):

  inline def id = _id

  def active = !withdraw

  def doWithdraw = copy(withdraw = true)
  def unWithdraw = copy(withdraw = false)

  def magicScore = score * Player.magicScoreBase + rank.ordinal

  def rankTitle: Option[RankCode] = rank.publicCode
  def showRank: String = rank.publicCode.fold("Unranked")(_.value)

object Player:

  /** Tournament points always dominate the native-rank tie-breaker. */
  val magicScoreBase = 100000

  given UserIdOf[Player] = _.userId

  case class WithUser(player: Player, user: User)

  case class Result(player: Player, lightUser: LightUser, rank: Int, sheet: Option[arena.Sheet])

  private[tournament] def make(
      tourId: TourId,
      user: WithPerf,
      team: Option[TeamId],
      bot: Boolean
  ): Player = Player(
    _id = TourPlayerId(ThreadLocalRandom.nextString(8)),
    tourId = tourId,
    userId = user.id,
    rank = user.rank.getOrElse(XiangqiRank.initialSnapshot),
    team = team,
    bot = bot
  )
