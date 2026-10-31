package lila.playerDirectory

import chess.PlayerName
import chess.rating.{ Elo, KFactor }
import play.api.libs.json.*
import play.api.libs.ws.StandaloneWSClient
import play.api.libs.ws.JsonBodyWritables.*
import play.api.libs.ws.JsonBodyReadables.*
import lila.core.playerDirectory.{ PlayerId, PlayerTitle, Provenance, Federation as CoreFederation }
import lila.core.id.ImageId

/** The directory uses the same catalog as game search and statistics. Only user follows remain in Mongo. This
  * client never keeps a second player store.
  */
final private class DirectoryCatalog(ws: StandaloneWSClient, config: play.api.Configuration)(using Executor):
  private val endpoint = config.get[String]("explorer.internal_endpoint").stripSuffix("/")
  private val token = config.get[String]("playerDirectory.writeTokenFile") match
    case "" => config.get[String]("playerDirectory.writeToken")
    case path => java.nio.file.Files.readString(java.nio.file.Path.of(path)).trim

  def query(body: JsObject): Fu[JsValue] = request("/players", body, write = false)
  def write(body: JsObject): Funit = request("/internal/players", body, write = true).void

  private def request(path: String, body: JsObject, write: Boolean): Fu[JsValue] =
    val base = ws.url(endpoint + path).withRequestTimeout(30.seconds)
    val request = if write then base.addHttpHeaders("Authorization" -> s"Bearer $token") else base
    request
      .post(body)
      .flatMap: response =>
        if response.status == 200 then fuccess(response.body[JsValue])
        else fufail(s"Player catalog returned HTTP ${response.status}")

  def fetch(reference: String): Fu[Option[DirectoryPlayer]] =
    query(Json.obj("action" -> "get", "id" -> reference))
      .map(j => (j \ "player").asOpt[JsObject].map(DirectoryCatalog.read))

  def edit(id: PlayerId, changes: JsObject): Funit =
    write(Json.obj("action" -> "edit", "id" -> id.value, "changes" -> changes))

object DirectoryCatalog:
  given OFormat[Provenance] = Json.format
  given OFormat[DirectoryPlayer.GameStats] = Json.using[Json.WithDefaultValues].format
  given OFormat[DirectoryPlayer.RecordedTitle] = Json.format

  def read(j: JsValue): DirectoryPlayer =
    def str(key: String) = (j \ key).asOpt[String]
    def num(key: String) = (j \ key).asOpt[Int]
    val name = PlayerName((j \ "name").as[String])
    val aliases = (j \ "aliases").asOpt[List[String]].getOrElse(Nil).map(PlayerName(_))
    DirectoryPlayer(
      id = PlayerId.parse((j \ "id").as[String]).get,
      name = name,
      displayName = PlayerName((j \ "displayName").as[String]),
      token = DirectoryPlayer.tokenize.exec(name.value),
      aliases = aliases,
      tokens = (name :: aliases).map(n => DirectoryPlayer.tokenize.exec(n.value)),
      provenance = (j \ "provenance").as[Provenance],
      ratingSources = (j \ "ratingSources").asOpt[Map[String, Provenance]].getOrElse(Map.empty),
      photo = (j \ "photo")
        .asOpt[JsObject]
        .map: p =>
          DirectoryPlayer.PlayerPhoto(
            ImageId((p \ "id").asOpt[String].getOrElse("")),
            (p \ "credit").asOpt[String],
            (p \ "url").asOpt[String],
            (p \ "sourceUrl").asOpt[String],
            (p \ "license").asOpt[String],
            (p \ "licenseUrl").asOpt[String]
          ),
      fed = str("fed").map(CoreFederation.Id(_)),
      title = str("title").flatMap(PlayerTitle.get),
      standard = num("standard").map(Elo(_)),
      standardK = num("standardK").map(KFactor(_)),
      rapid = num("rapid").map(Elo(_)),
      rapidK = num("rapidK").map(KFactor(_)),
      blitz = num("blitz").map(Elo(_)),
      blitzK = num("blitzK").map(KFactor(_)),
      year = num("year"),
      deceasedYear = num("deceasedYear"),
      gender = str("gender").flatMap(_.headOption).map(DirectoryPlayer.Gender(_)),
      inactive = (j \ "inactive").asOpt[Boolean].getOrElse(false),
      biography = (j \ "biography").asOpt[Map[String, String]].getOrElse(Map.empty),
      biographySources = (j \ "biographySources").asOpt[List[String]].getOrElse(Nil),
      team = str("team"),
      teamAsOf = str("teamAsOf"),
      stats = (j \ "stats").asOpt[DirectoryPlayer.GameStats].getOrElse(DirectoryPlayer.GameStats()),
      titles = (j \ "titles").as[List[DirectoryPlayer.RecordedTitle]]
    )
