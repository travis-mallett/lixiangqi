package lila.challenge

import lila.core.i18n.I18nKey.challenge as trans
import lila.core.i18n.Translate
import lila.core.relation.Relation.{ Block, Follow }

case class ChallengeDenied(dest: User, reason: ChallengeDenied.Reason)

object ChallengeDenied:

  enum Reason:
    case YouAreAnon
    case YouAreBlocked
    case Isolated
    case TheyDontAcceptChallenges
    case FriendsOnly
    case BotUltraBullet
    case SelfChallenge

  def translated(d: ChallengeDenied)(using Translate): String =
    d.reason match
      case Reason.YouAreAnon => trans.registerToSendChallenges.txt()
      case Reason.YouAreBlocked | Reason.Isolated => trans.youCannotChallengeX.txt(d.dest.titleUsername)
      case Reason.TheyDontAcceptChallenges => trans.xDoesNotAcceptChallenges.txt(d.dest.titleUsername)
      case Reason.FriendsOnly => trans.xOnlyAcceptsChallengesFromFriends.txt(d.dest.titleUsername)
      case Reason.BotUltraBullet => "Bots cannot play UltraBullet. Choose a slower time control."
      case Reason.SelfChallenge => "You cannot challenge yourself."

final class ChallengeGranter(
    prefApi: lila.core.pref.PrefApi,
    relationApi: lila.core.relation.RelationApi
):

  import ChallengeDenied.Reason.*

  def mayChallenge(dest: User)(using Executor)(using me: Option[Me]): Fu[Boolean] =
    isDenied(dest, None).map(_.isEmpty)

  // perfkey is None when we're not yet trying to challenge
  def isDenied(dest: User, perfKey: Option[PerfKey])(using
      Executor
  )(using me: Option[Me]): Fu[Option[ChallengeDenied]] = me
    .match
      case None =>
        prefApi
          .getChallenge(dest.id)
          .map:
            case lila.core.pref.Challenge.ALWAYS => none
            case _ => YouAreAnon.some
      case Some(from) if from.marks.alt => fuccess(Isolated.some)
      case Some(from) =>
        type Res = Option[ChallengeDenied.Reason]
        given Conversion[Res, Fu[Res]] = fuccess
        relationApi
          .fetchRelation(dest.id, from.userId)
          .zip(prefApi.getChallenge(dest.id))
          .flatMap:
            case (Some(Block), _) => YouAreBlocked.some
            case (_, lila.core.pref.Challenge.NEVER) => TheyDontAcceptChallenges.some
            case (Some(Follow), _) => none // always accept from followed
            case (_, _) if from.marks.engine && !dest.marks.engine => YouAreBlocked.some
            case (_, lila.core.pref.Challenge.FRIEND) => FriendsOnly.some
            // The retired rating-range preference now means "registered users". Custom challenges
            // are casual; native rank compatibility is enforced only by the ranked 15-minute pool.
            case (_, lila.core.pref.Challenge.RATING) => none
            case (_, lila.core.pref.Challenge.REGISTERED) => none
            case _ if from == dest => SelfChallenge.some
            case _ => none
    .map:
      case None if dest.isBot && perfKey == PerfKey.ultraBullet => BotUltraBullet.some
      case res => res
    .map:
      _.map { ChallengeDenied(dest, _) }
