package lila.video

import java.net.URI
import scala.util.Try

import play.api.libs.json.*
import play.api.libs.ws.JsonBodyReadables.*
import play.api.libs.ws.StandaloneWSClient

final class BilibiliProvider(ws: StandaloneWSClient, apiUrl: String)(using Executor)
    extends ExternalVideoProvider:

  val provider = VideoProvider.Bilibili

  def parse(input: String): Option[VideoSource] = BilibiliProvider.parse(input)

  def fetch(externalId: String): Fu[Either[String, VideoMetadata]] =
    ws.url(apiUrl)
      .withQueryStringParameters("bvid" -> externalId)
      .get()
      .map: response =>
        if response.status != 200 then Left(s"Bilibili metadata request failed (${response.status}).")
        else
          val json = response.body[JsValue]
          (json \ "code").asOpt[Int] match
            case Some(0) =>
              val data = (json \ "data").asOpt[JsObject] | Json.obj()
              Right(
                VideoMetadata(
                  title = (data \ "title").asOpt[String],
                  author = (data \ "owner" \ "name").asOpt[String],
                  description = (data \ "desc").asOpt[String],
                  duration = (data \ "duration").asOpt[Int],
                  thumbnail = (data \ "pic").asOpt[String].map(httpsUrl),
                  publishedAt = (data \ "pubdate").asOpt[Long].map(java.time.Instant.ofEpochSecond),
                  available = true,
                  refreshedAt = nowInstant,
                  error = none
                )
              )
            case Some(-404) => Right(VideoMetadata.unavailable)
            case _ => Left((json \ "message").asOpt[String] | "Bilibili returned no metadata.")
      .recover(error => Left(s"Bilibili metadata request failed: ${error.getMessage}"))

  def fetchMany(externalIds: List[String]): Fu[Map[String, Either[String, VideoMetadata]]] =
    externalIds.distinct
      .sequentially: id =>
        fetch(id).map(id -> _)
      .map(_.toMap)

  private def httpsUrl(url: String) =
    if url.startsWith("//") then s"https:$url"
    else if url.startsWith("http://") then s"https://${url.drop(7)}"
    else url

object BilibiliProvider:

  private val idRegex = "(?i)^BV[A-Za-z0-9]{10}$".r

  def parse(input: String): Option[VideoSource] =
    val trimmed = input.trim
    val id =
      idRegex
        .findFirstIn(trimmed)
        .orElse:
          Try(URI.create(trimmed)).toOption.flatMap: uri =>
            val host = Option(uri.getHost).fold("")(_.toLowerCase)
            if host == "bilibili.com" || host.endsWith(".bilibili.com") then
              Option(uri.getPath).toList
                .flatMap(_.split('/'))
                .find(idRegex.matches)
            else none
    id.map: validId =>
      val canonicalId = s"BV${validId.drop(2)}"
      VideoSource(VideoProvider.Bilibili, canonicalId, s"https://www.bilibili.com/video/$canonicalId")
