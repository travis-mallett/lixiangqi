package lila.playerDirectory

import scala.util.Success
import java.time.YearMonth
import lila.core.playerDirectory.RatingCategory
import lila.core.playerDirectory.PlayerId
import chess.rating.Elo
import reactivemongo.api.bson.*

import lila.core.playerDirectory.{ Federation, DirectoryPlayerOrder }
import lila.db.dsl.{ *, given }

final private class DirectoryRepo(
    private[playerDirectory] val playerColl: Coll,
    private[playerDirectory] val ratingColl: Coll,
    private[playerDirectory] val federationColl: Coll,
    private[playerDirectory] val followerColl: Coll
)(using Executor):

  object player:
    given BSONDocumentHandler[lila.core.playerDirectory.Provenance] = Macros.handler
    given BSONDocumentHandler[DirectoryPlayer.PlayerPhoto] = Macros.handler
    given BSONHandler[DirectoryPlayer.Gender] = quickHandler(
      { case BSONString(g) if g.nonEmpty => DirectoryPlayer.Gender(g.head) },
      g => BSONString(g.toString)
    )
    given handler: BSONDocumentHandler[DirectoryPlayer] = Macros.handler
    val selectActive: Bdoc = $doc("inactive".$ne(true))
    def selectFed(fed: Federation.Id): Bdoc = $doc("fed" -> fed)
    def sortStandard: Bdoc = $sort.desc("standard")
    def sortBy(o: DirectoryPlayerOrder) = o match
      case DirectoryPlayerOrder.name => $sort.asc("name")
      case DirectoryPlayerOrder.standard => $sort.desc("standard")
      case DirectoryPlayerOrder.rapid => $sort.desc("rapid")
      case DirectoryPlayerOrder.blitz => $sort.desc("blitz")
      case DirectoryPlayerOrder.year => $sort.desc("year")
      case DirectoryPlayerOrder.follow => $empty // TODO
    def fetch(id: PlayerId): Fu[Option[DirectoryPlayer]] = playerColl.byId[DirectoryPlayer](id)
    def fetch(ids: Seq[PlayerId]): Fu[List[DirectoryPlayer]] =
      playerColl.find($inIds(ids)).cursor[DirectoryPlayer](ReadPref.sec).listAll()
    def countAll = playerColl.count()
    def setPhoto(id: PlayerId, photo: DirectoryPlayer.PlayerPhoto): Funit =
      playerColl.updateField($id(id), "photo", photo).void
    def setPhotoCredit(p: DirectoryPlayer, credit: Option[String]): Funit =
      playerColl.updateOrUnsetField($id(p.id) ++ $doc("photo.id".$exists(true)), "photo.credit", credit).void
    def setDeceasedYear(id: PlayerId, year: Option[Int]): Funit =
      playerColl.updateOrUnsetField($id(id), "deceasedYear", year).void

  object rating:
    given BSONDocumentHandler[DirectoryRatingHistory] = Macros.handler
    def get(id: PlayerId): Fu[DirectoryRatingHistory] =
      ratingColl.byId[DirectoryRatingHistory](id).map(_ | DirectoryRatingHistory.empty(id))
    def set(id: PlayerId, date: YearMonth, elos: Map[RatingCategory, Elo]): Funit = elos.nonEmpty.so:
      for
        history <- get(id)
        updated = history.set(date, elos)
        _ <- ratingColl.update.one($id(id), updated, upsert = true)
      yield ()

  object federation:
    given BSONDocumentHandler[Federation.Stats] = Macros.handler
    given handler: BSONDocumentHandler[Federation] = Macros.handler
    def upsert(fed: Federation): Funit =
      federationColl.update.one($id(fed.id), fed, upsert = true).void
    def fetch(code: Federation.Id): Fu[Option[Federation]] = federationColl.byId[Federation](code)

  object follower:
    // { _id: '14204118/thibault', u: 'thibault', p: 14204118 }
    type FollowId = String
    private object followId:
      def make(p: PlayerId, u: UserId) = s"$p/$u"
      def toUserId(id: FollowId): UserId = UserId(id.drop(id.indexOf('/') + 1))
      def toPlayerId(id: FollowId): PlayerId = PlayerId
        .parse(id.takeWhile(_ != '/'))
        .getOrElse(throw IllegalArgumentException("Invalid directory follow identity"))

    def followers(p: PlayerId): Fu[Set[UserId]] = PlayerId
      .parse(p.value)
      .isDefined
      .so:
        for ids <- followerColl.distinctEasy[FollowId, Set]("_id", "_id".$startsWith(s"$p/"))
        yield ids.map(followId.toUserId)
    def follow(u: UserId, p: PlayerId) = playerColl
      .exists($id(p))
      .flatMapz:
        followerColl.update.one($id(followId.make(p, u)), $doc("u" -> u, "p" -> p), upsert = true).void
    def unfollow(u: UserId, p: PlayerId) = followerColl.delete.one($id(followId.make(p, u))).void
    def isFollowing(u: UserId, p: PlayerId) = followerColl.exists($id(followId.make(p, u)))

    def count(u: UserId): Fu[Int] = followerColl.countSel($doc("u" -> u))

    def withFollows(players: Seq[DirectoryPlayer], u: UserId): Fu[Seq[DirectoryPlayer.WithFollow]] =
      val ids = players.map(_.id).map(followId.make(_, u))
      followerColl
        .distinctEasy[FollowId, Set]("_id", "_id".$in(ids))
        .map(_.map(followId.toPlayerId))
        .map: followedIds =>
          players.map: p =>
            DirectoryPlayer.WithFollow(p, followedIds.contains(p.id))
