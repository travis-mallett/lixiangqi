package lila.video

enum VideoProvider(val key: String, val label: String):
  case Youtube extends VideoProvider("youtube", "YouTube")
  case Bilibili extends VideoProvider("bilibili", "Bilibili")

object VideoProvider:
  val choices = values.toList.map(p => p.key -> p.label)
  def byKey(key: String): Option[VideoProvider] = values.find(_.key == key)

enum VideoStatus(val key: String, val label: String):
  case Draft extends VideoStatus("draft", "Draft")
  case Published extends VideoStatus("published", "Published")
  case Archived extends VideoStatus("archived", "Archived")

object VideoStatus:
  val choices = values.toList.map(s => s.key -> s.label)
  def byKey(key: String): Option[VideoStatus] = values.find(_.key == key)

case class VideoSource(provider: VideoProvider, externalId: String, canonicalUrl: String):

  def embedUrl(startTime: Int): String = provider match
    case VideoProvider.Youtube =>
      s"https://www.youtube-nocookie.com/embed/$externalId?autoplay=1&start=${startTime.max(0)}"
    case VideoProvider.Bilibili =>
      s"https://player.bilibili.com/player.html?bvid=$externalId&page=1&high_quality=1&danmaku=0&t=${startTime.max(0)}"

case class VideoMetadata(
    title: Option[String],
    author: Option[String],
    description: Option[String],
    duration: Option[Int],
    thumbnail: Option[String],
    publishedAt: Option[Instant],
    available: Boolean,
    refreshedAt: Instant,
    error: Option[String]
):

  def failed(message: String) = copy(refreshedAt = nowInstant, error = message.take(500).some)

object VideoMetadata:
  def empty = VideoMetadata(None, None, None, None, None, None, available = true, nowInstant, None)
  def unavailable = empty.copy(available = false)

case class Video(
    _id: Video.ID,
    source: VideoSource,
    title: String,
    author: String,
    description: Option[String],
    targets: List[Target],
    tags: List[Tag],
    lang: Lang,
    ads: Boolean,
    startTime: Int,
    status: VideoStatus,
    sortOrder: Int,
    metadata: VideoMetadata,
    createdAt: Instant,
    createdBy: Option[UserId],
    updatedAt: Instant,
    updatedBy: Option[UserId]
):

  inline def id = _id

  def thumbnail: Option[String] = metadata.thumbnail.orElse:
    source.provider match
      case VideoProvider.Youtube => s"https://img.youtube.com/vi/${source.externalId}/0.jpg".some
      case VideoProvider.Bilibili => none

  def effectiveDescription = description.orElse(metadata.description)
  def isPublished = status == VideoStatus.Published

  def similarity(other: Video) =
    tags.intersect(other.tags).size +
      targets.intersect(other.targets).size +
      (author == other.author).so(1)

  def durationString =
    metadata.duration.map: seconds =>
      val hours = seconds / 3600
      val minutes = (seconds % 3600) / 60
      val remainingSeconds = seconds % 60
      if hours > 0 then f"$hours%d:$minutes%02d:$remainingSeconds%02d"
      else f"$minutes%d:$remainingSeconds%02d"

  override def toString = s"[$id] $title ($author)"

object Target:
  val BEGINNER = 1
  val INTERMEDIATE = 2
  val ADVANCED = 3
  val EXPERT = 4

  val choices = List(
    BEGINNER -> "Beginner",
    INTERMEDIATE -> "Intermediate",
    ADVANCED -> "Advanced",
    EXPERT -> "Expert"
  )

  def name(target: Int) = choices.toMap.getOrElse(target, "")

object Video:

  type ID = String

  def makeId: ID = scalalib.ThreadLocalRandom.nextString(12)
