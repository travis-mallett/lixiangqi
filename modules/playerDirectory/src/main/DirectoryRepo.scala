package lila.playerDirectory

import lila.core.playerDirectory.{ PlayerId, Federation as CoreFederation }
import lila.db.dsl.{ *, given }
import play.api.libs.json.*

final private class DirectoryRepo(
    catalog: DirectoryCatalog,
    private[playerDirectory] val followerColl: Coll
)(using Executor):
  object player:
    def fetch(id: PlayerId): Fu[Option[DirectoryPlayer]] = catalog.fetch(id.value)
    def resolve(reference: String): Fu[Option[DirectoryPlayer]] = catalog.fetch(reference)
    def fetch(ids: Seq[PlayerId]): Fu[List[DirectoryPlayer]] =
      catalog
        .query(Json.obj("action" -> "batch", "ids" -> ids.map(_.value)))
        .map(j => (j \ "players").as[List[JsValue]].map(DirectoryCatalog.read))
    def countAll: Fu[Int] = catalog.query(Json.obj("pageSize" -> 1)).map(j => (j \ "total").as[Int])
    def setPhoto(id: PlayerId, photo: DirectoryPlayer.PlayerPhoto): Funit =
      catalog.edit(id, Json.obj("photo" -> Json.obj("id" -> photo.id.value, "credit" -> photo.credit)))
    def edit(p: DirectoryPlayer, language: String, edit: DirectoryPlayer.form.Edit): Funit =
      val biography = edit.biography.fold(p.biography - language)(text => p.biography.updated(language, text))
      val fields = Json.obj(
        "biography" -> biography,
        "biographySources" -> edit.sources.toList.flatMap(_.linesIterator.map(_.trim).filter(_.nonEmpty))
      )
      val photo = p.photo
        .map(ph =>
          Json.obj(
            "photo" -> Json.obj(
              "id" -> ph.id.value,
              "credit" -> edit.credit,
              "url" -> ph.url,
              "sourceUrl" -> ph.sourceUrl,
              "license" -> ph.license,
              "licenseUrl" -> ph.licenseUrl
            )
          )
        )
        .getOrElse(Json.obj())
      catalog.edit(p.id, fields ++ photo)
    def setDeceasedYear(id: PlayerId, year: Option[Int]): Funit =
      catalog.edit(id, Json.obj("deceasedYear" -> year))

  def list(query: JsObject): Fu[(Int, List[DirectoryPlayer])] =
    catalog
      .query(query)
      .map(j => ((j \ "total").as[Int], (j \ "players").as[List[JsValue]].map(DirectoryCatalog.read)))

  object rating:
    def get(id: PlayerId): Fu[DirectoryRatingHistory] =
      catalog
        .query(Json.obj("action" -> "get", "id" -> id.value))
        .map: j =>
          val history = j \ "player" \ "ratingsHistory"
          DirectoryRatingHistory.fromJson(id, history.asOpt[JsObject].getOrElse(Json.obj()))

  object federation:
    def all: Fu[List[Federation]] =
      catalog
        .query(Json.obj("action" -> "federations"))
        .map: j =>
          (j \ "federations")
            .as[List[JsValue]]
            .map: row =>
              val id = CoreFederation.Id((row \ "id").as[String])
              val count = (row \ "nbPlayers").as[Int]
              def stats(category: String) =
                val value = row \ category
                CoreFederation.Stats(
                  (value \ "rank").asOpt[Int].getOrElse(0),
                  (value \ "nbPlayers").asOpt[Int].getOrElse(0),
                  (value \ "top10Rating").asOpt[Int].getOrElse(0)
                )
              Federation(
                id,
                Federation.name(id),
                count,
                stats("standard"),
                stats("rapid"),
                stats("blitz"),
                nowInstant
              )
    def fetch(code: CoreFederation.Id): Fu[Option[Federation]] = all.map(_.find(_.id == code))

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
    def follow(u: UserId, p: PlayerId) = player
      .fetch(p)
      .map(_.isDefined)
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

    def followedIds(u: UserId): Fu[List[PlayerId]] =
      followerColl.distinctEasy[PlayerId, List]("p", $doc("u" -> u))
