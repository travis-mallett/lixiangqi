package lila.video

import reactivemongo.api.bson.*

import lila.db.BSON
import lila.db.dsl.{ Bdoc, given }

private[video] object BsonHandlers:

  given BSONDocumentHandler[Video] = new BSON[Video]:

    def reads(r: BSON.Reader): Video =
      val id = r.str("_id")
      val createdAt = r.dateD("createdAt", nowInstant)
      val metadata = r.getO[Bdoc]("metadata").fold(VideoMetadata.empty)(readMetadata)
      Video(
        _id = id,
        source = r.getO[Bdoc]("source").fold(legacySource(id))(readSource),
        title = r.str("title"),
        author = r.str("author"),
        description = r.strO("description"),
        targets = r.intsD("targets"),
        tags = r.strsD("tags"),
        lang = r.strD("lang").nonEmptyOption | "en",
        ads = r.boolD("ads"),
        startTime = r.intD("startTime"),
        status = r.strO("status").flatMap(VideoStatus.byKey) | VideoStatus.Published,
        sortOrder = r.intO("sortOrder") | Int.MaxValue,
        metadata = metadata,
        createdAt = createdAt,
        createdBy = r.getO[UserId]("createdBy"),
        updatedAt = r.dateD("updatedAt", createdAt),
        updatedBy = r.getO[UserId]("updatedBy")
      )

    def writes(w: BSON.Writer, video: Video) = BSONDocument(
      "_id" -> video.id,
      "source" -> writeSource(video.source),
      "title" -> video.title,
      "author" -> video.author,
      "description" -> video.description,
      "targets" -> video.targets,
      "tags" -> video.tags,
      "lang" -> video.lang,
      "ads" -> video.ads,
      "startTime" -> video.startTime,
      "status" -> video.status.key,
      "sortOrder" -> video.sortOrder,
      "metadata" -> metadataDocument(video.metadata),
      "createdAt" -> video.createdAt,
      "createdBy" -> video.createdBy,
      "updatedAt" -> video.updatedAt,
      "updatedBy" -> video.updatedBy
    )

  private def legacySource(id: Video.ID) =
    VideoSource(VideoProvider.Youtube, id, s"https://www.youtube.com/watch?v=$id")

  private def readSource(doc: Bdoc) =
    val r = new BSON.Reader(doc)
    val externalId = r.str("externalId")
    val provider = r.strO("provider").flatMap(VideoProvider.byKey) | VideoProvider.Youtube
    VideoSource(
      provider = provider,
      externalId = externalId,
      canonicalUrl = r.strO("canonicalUrl") | providerUrl(provider, externalId)
    )

  private def writeSource(source: VideoSource) = BSONDocument(
    "provider" -> source.provider.key,
    "externalId" -> source.externalId,
    "canonicalUrl" -> source.canonicalUrl
  )

  private def providerUrl(provider: VideoProvider, id: String) = provider match
    case VideoProvider.Youtube => s"https://www.youtube.com/watch?v=$id"
    case VideoProvider.Bilibili => s"https://www.bilibili.com/video/$id"

  private def readMetadata(doc: Bdoc) =
    val r = new BSON.Reader(doc)
    VideoMetadata(
      title = r.strO("title"),
      author = r.strO("author"),
      description = r.strO("description"),
      duration = r.intO("duration"),
      thumbnail = r.strO("thumbnail"),
      publishedAt = r.dateO("publishedAt"),
      available = r.boolO("available") | true,
      refreshedAt = r.dateD("refreshedAt", nowInstant),
      error = r.strO("error")
    )

  def metadataDocument(metadata: VideoMetadata) = BSONDocument(
    "title" -> metadata.title,
    "author" -> metadata.author,
    "description" -> metadata.description,
    "duration" -> metadata.duration,
    "thumbnail" -> metadata.thumbnail,
    "publishedAt" -> metadata.publishedAt,
    "available" -> metadata.available,
    "refreshedAt" -> metadata.refreshedAt,
    "error" -> metadata.error
  )
