package lila.video

import play.api.data.*
import play.api.data.Forms.*
import play.api.data.validation.Constraints

import lila.common.Form.{ cleanNonEmptyText, cleanTextWithSymbols, stringIn }

object VideoForm:

  val form = Form(
    mapping(
      "sourceUrl" -> nonEmptyText(maxLength = 500),
      "title" -> cleanNonEmptyText(minLength = 2, maxLength = 200),
      "author" -> cleanNonEmptyText(minLength = 2, maxLength = 120),
      "description" -> optional(cleanTextWithSymbols(maxLength = 20_000)),
      "targets" -> list(number(min = Target.BEGINNER, max = Target.EXPERT))
        .verifying("Select at least one skill level", _.nonEmpty),
      "tags" -> cleanTextWithSymbols(maxLength = 1_000),
      "lang" -> text(maxLength = 12).verifying(
        Constraints.pattern("^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$".r, "Enter a valid language code")
      ),
      "ads" -> boolean,
      "startTime" -> number(min = 0, max = 86_400),
      "status" -> stringIn(VideoStatus.choices)
    )(Data.apply)(unapply)
  )

  val create = form.fill(
    Data(
      sourceUrl = "",
      title = "",
      author = "",
      description = none,
      targets = List(Target.BEGINNER),
      tags = "",
      lang = "en",
      ads = false,
      startTime = 0,
      status = VideoStatus.Draft.key
    )
  )

  def edit(video: Video) = form.fill:
    Data(
      sourceUrl = video.source.canonicalUrl,
      title = video.title,
      author = video.author,
      description = video.description,
      targets = video.targets,
      tags = video.tags.mkString(", "),
      lang = video.lang,
      ads = video.ads,
      startTime = video.startTime,
      status = video.status.key
    )

  case class Data(
      sourceUrl: String,
      title: String,
      author: String,
      description: Option[String],
      targets: List[Int],
      tags: String,
      lang: String,
      ads: Boolean,
      startTime: Int,
      status: String
  ):

    def normalizedTags: List[Tag] =
      tags
        .split("[,;\\n]")
        .map(_.trim.toLowerCase)
        .filter(_.nonEmpty)
        .distinct
        .take(20)
        .toList

    private def normalizedDescription = description.map(_.trim).filter(_.nonEmpty)

    def make(source: VideoSource, metadata: VideoMetadata, sortOrder: Int)(using me: MyId) =
      val at = nowInstant
      Video(
        _id = Video.makeId,
        source = source,
        title = title.trim,
        author = author.trim,
        description = normalizedDescription,
        targets = targets.distinct.sorted,
        tags = normalizedTags,
        lang = lang.trim.toLowerCase,
        ads = ads,
        startTime = startTime,
        status = VideoStatus.byKey(status) | VideoStatus.Draft,
        sortOrder = sortOrder,
        metadata = metadata,
        createdAt = at,
        createdBy = me.userId.some,
        updatedAt = at,
        updatedBy = me.userId.some
      )

    def update(video: Video, source: VideoSource, metadata: VideoMetadata)(using me: MyId) = video.copy(
      source = source,
      title = title.trim,
      author = author.trim,
      description = normalizedDescription,
      targets = targets.distinct.sorted,
      tags = normalizedTags,
      lang = lang.trim.toLowerCase,
      ads = ads,
      startTime = startTime,
      status = VideoStatus.byKey(status) | video.status,
      metadata = metadata,
      updatedAt = nowInstant,
      updatedBy = me.userId.some
    )
