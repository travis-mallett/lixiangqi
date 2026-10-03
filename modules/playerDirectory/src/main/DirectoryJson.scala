package lila.playerDirectory

import play.api.libs.json.*
import lila.common.Json.{ *, given }
import lila.core.playerDirectory.PhotosJson

final class DirectoryJson(picfitUrl: lila.memo.PicfitUrl):

  given OWrites[lila.core.playerDirectory.Provenance] = Json.writes

  given photoWrites: OWrites[DirectoryPlayer.PlayerPhoto] = OWrites: p =>
    Json
      .obj(
        "small" -> DirectoryPlayer.PlayerPhoto(picfitUrl, p.id, _.Small),
        "medium" -> DirectoryPlayer.PlayerPhoto(picfitUrl, p.id, _.Medium)
      )
      .add("credit" -> p.credit)

  given Writes[DirectoryPlayer.Gender] = writeAs(_.value.toString)

  def photosJson(photos: Map[lila.core.playerDirectory.PlayerId, DirectoryPlayer.PlayerPhoto]) = PhotosJson:
    JsObject:
      photos.map: (id, photo) =>
        id.value.toString -> photoWrites.writes(photo)

  given OWrites[DirectoryPlayer] = OWrites: p =>
    Json
      .obj(
        "id" -> p.id,
        "name" -> p.name,
        "federation" -> p.fed,
        "year" -> p.year,
        "aliases" -> p.aliases,
        "provenance" -> p.provenance,
        "ratingSources" -> p.ratingSources
      )
      .add("title" -> p.title)
      .add("inactive" -> p.inactive)
      .add("standard" -> p.standard)
      .add("rapid" -> p.rapid)
      .add("blitz" -> p.blitz)
      .add("gender" -> p.gender)
      .add("photo" -> p.photo)

  given OWrites[DirectoryPlayer.WithFollow] = OWrites: p =>
    Json.toJsObject(p.player).add("following" -> p.follow)
