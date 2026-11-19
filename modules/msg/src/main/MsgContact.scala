package lila.msg

import reactivemongo.api.bson.*
import reactivemongo.api.bson.Macros.Annotations.Key

import lila.core.perm.{ Granter, Permission }
import lila.core.user.{ RoleDbKey, UserMarks }
import lila.db.dsl.{ *, given }

private case class Contact(
    @Key("_id") id: UserId,
    kid: Option[Boolean],
    marks: Option[UserMarks],
    roles: Option[List[RoleDbKey]],
    createdAt: Instant,
    seenAt: Option[Instant],
    enabled: Option[Boolean] = None
):
  def isKid = ~kid
  def isTroll = marks.exists(_.troll)
  def isAlt = marks.exists(_.alt)
  def isVerified = Granter.ofDbKeys(_.Verified, ~roles)
  def isApiHog = Granter.ofDbKeys(_.ApiHog, ~roles)
  def isBroadcastManager = Granter.ofDbKeys(_.Relay, ~roles)
  def isDaysOld(days: Int) = createdAt.isBefore(nowInstant.minusDays(days))
  def isHoursOld(hours: Int) = createdAt.isBefore(nowInstant.minusHours(hours))
  def isLichess = id.is(UserId.lichess)
  def isGranted(perm: Permission.Selector) = Granter.ofDbKeys(perm, ~roles)
  def seenRecently = seenAt.exists(_.isAfter(nowInstant.minusHours(1)))

private case class Contacts(orig: Contact, dest: Contact):
  def hasKid = orig.isKid || dest.isKid
  def activeAdults = !hasKid && !any(c => !c.enabled.contains(true))
  def userIds = List(orig.id, dest.id)
  def any(f: Contact => Boolean) = f(orig) || f(dest)

private final class ContactApi(userColl: Coll)(using Executor):

  private given BSONDocumentHandler[Contact] = Macros.handler[Contact]

  /** Taking a write lock makes a concurrent Kid/account status transition conflict with this media commit. */
  def guardMedia(tx: reactivemongo.api.DB, users: List[UserId]): Funit =
    val ids = users.distinct
    val records: Coll = tx.collection(userColl.name)
    records.update
      .one($inIds(ids) ++ $doc("enabled" -> true, "kid".$ne(true)), $inc("mediaRevision" -> 1), multi = true)
      .flatMap: res =>
        if res.n == ids.size then funit else fufail(lila.core.security.SubmissionRejected("privateTextOnly"))

  def adultIds(ids: List[UserId]): Fu[Set[UserId]] =
    userColl.distinctEasy[UserId, Set]("_id", $inIds(ids) ++ $doc("enabled" -> true, "kid".$ne(true)))

  def mediaUsers(ids: List[UserId]): Fu[Set[UserId]] =
    userColl
      .find($inIds(ids) ++ $doc("enabled" -> true, "kid".$ne(true)))
      .cursor[Contact]()
      .list(ids.size)
      .map(_.collect { case c if !c.isTroll && !c.isAlt => c.id }.toSet)

  def contacts(orig: UserId, dest: UserId): Fu[Option[Contacts]] =
    import lila.core.user.BSONFields as F
    userColl
      .byOrderedIds[Contact, UserId](
        List(orig, dest),
        $doc(
          F.kid -> true,
          F.enabled -> true,
          F.marks -> true,
          F.roles -> true,
          F.createdAt -> true,
          F.seenAt -> true
        ).some
      )(_.id)
      .map:
        case List(o, d) => Contacts(o, d).some
        case _ => none
