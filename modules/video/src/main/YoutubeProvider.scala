package lila.video

import java.net.{ URI, URLDecoder }
import java.nio.charset.StandardCharsets
import scala.util.Try

import play.api.libs.json.*
import play.api.libs.ws.JsonBodyReadables.*
import play.api.libs.ws.StandaloneWSClient

import lila.core.config.Secret

final class YoutubeProvider(ws: StandaloneWSClient, apiUrl: String, apiKey: Secret)(using Executor)
    extends ExternalVideoProvider:

  val provider = VideoProvider.Youtube

  def parse(input: String): Option[VideoSource] = YoutubeProvider.parse(input)

  def fetch(externalId: String): Fu[Either[String, VideoMetadata]] =
    if apiKey.value.isEmpty then fetchOEmbed(externalId)
    else fetchMany(List(externalId)).map(_.getOrElse(externalId, Left("YouTube returned no metadata.")))

  override def fetchMany(externalIds: List[String]): Fu[Map[String, Either[String, VideoMetadata]]] =
    val ids = externalIds.distinct.take(50)
    if ids.isEmpty then fuccess(Map.empty)
    else if apiKey.value.isEmpty then ids.sequentially(id => fetchOEmbed(id).map(id -> _)).map(_.toMap)
    else
      ws.url(apiUrl)
        .withQueryStringParameters(
          "id" -> ids.mkString(","),
          "part" -> "id,snippet,contentDetails",
          "key" -> apiKey.value
        )
        .get()
        .map: response =>
          if response.status != 200 then
            ids
              .map(id =>
                id -> (Left(s"YouTube metadata request failed (${response.status})."): Either[
                  String,
                  VideoMetadata
                ])
              )
              .toMap
          else
            val entries = (response.body[JsValue] \ "items").asOpt[List[JsObject]] | Nil
            val found = entries.flatMap: entry =>
              (entry \ "id")
                .asOpt[String]
                .map: id =>
                  id -> Right(readMetadata(entry))
            val missing = ids
              .filterNot(id => found.exists(_._1 == id))
              .map: id =>
                id -> (Right(VideoMetadata.unavailable): Either[String, VideoMetadata])
            (found ++ missing).toMap
        .recover: error =>
          ids
            .map(id =>
              id -> (Left(s"YouTube metadata request failed: ${error.getMessage}"): Either[
                String,
                VideoMetadata
              ])
            )
            .toMap

  private def fetchOEmbed(externalId: String): Fu[Either[String, VideoMetadata]] =
    ws.url("https://www.youtube.com/oembed")
      .withQueryStringParameters(
        "url" -> s"https://www.youtube.com/watch?v=$externalId",
        "format" -> "json"
      )
      .get()
      .map: response =>
        if response.status == 404 then Right(VideoMetadata.unavailable)
        else if response.status != 200 then Left(s"YouTube metadata request failed (${response.status}).")
        else
          val json = response.body[JsValue]
          Right(
            VideoMetadata.empty.copy(
              title = (json \ "title").asOpt[String],
              author = (json \ "author_name").asOpt[String],
              thumbnail = (json \ "thumbnail_url").asOpt[String]
            )
          )
      .recover(error => Left(s"YouTube metadata request failed: ${error.getMessage}"))

  private def readMetadata(entry: JsObject) =
    val snippet = (entry \ "snippet").asOpt[JsObject] | Json.obj()
    val details = (entry \ "contentDetails").asOpt[JsObject] | Json.obj()
    val thumbnails = (snippet \ "thumbnails").asOpt[JsObject] | Json.obj()
    val thumbnail = List("maxres", "standard", "high", "medium", "default").flatMap: size =>
      (thumbnails \ size \ "url").asOpt[String]
    VideoMetadata(
      title = (snippet \ "title").asOpt[String],
      author = (snippet \ "channelTitle").asOpt[String],
      description = (snippet \ "description").asOpt[String],
      duration = (details \ "duration")
        .asOpt[String]
        .flatMap: duration =>
          Try(java.time.Duration.parse(duration).getSeconds.toInt).toOption,
      thumbnail = thumbnail.headOption,
      publishedAt = (snippet \ "publishedAt")
        .asOpt[String]
        .flatMap: at =>
          Try(java.time.Instant.parse(at)).toOption,
      available = true,
      refreshedAt = nowInstant,
      error = none
    )

object YoutubeProvider:

  private val idRegex = "^[A-Za-z0-9_-]{11}$".r
  private val pathKinds = Set("embed", "shorts", "live")

  def parse(input: String): Option[VideoSource] =
    val trimmed = input.trim
    val id =
      idRegex
        .findFirstIn(trimmed)
        .orElse:
          Try(URI.create(trimmed)).toOption.flatMap: uri =>
            val host = Option(uri.getHost).fold("")(_.toLowerCase)
            val parts = Option(uri.getPath).fold(List.empty[String])(_.split('/').filter(_.nonEmpty).toList)
            if host == "youtu.be" || host.endsWith(".youtu.be") then parts.headOption
            else if host == "youtube.com" || host.endsWith(".youtube.com") then
              parts match
                case kind :: videoId :: _ if pathKinds(kind) => videoId.some
                case _ => queryParam(uri, "v")
            else none
    id.filter(idRegex.matches)
      .map: validId =>
        VideoSource(provider = VideoProvider.Youtube, validId, s"https://www.youtube.com/watch?v=$validId")

  private def queryParam(uri: URI, name: String): Option[String] =
    Option(uri.getRawQuery).toList
      .flatMap(_.split('&'))
      .flatMap: part =>
        part.split("=", 2).toList match
          case key :: value :: Nil if key == name =>
            URLDecoder.decode(value, StandardCharsets.UTF_8).some
          case _ => none
      .headOption
