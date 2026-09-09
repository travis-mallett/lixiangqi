package lila.video

case class VideoTag(_id: Tag, description: String, sortOrder: Int, videoIds: List[Video.ID]):
  def name = _id

object VideoTag:
  private val number = "[0-9]+".r

  def naturalOrder(name: String): (Int, String) =
    val lower = name.toLowerCase(java.util.Locale.ROOT)
    val level =
      if lower.contains("how to play") then 0
      else number.findFirstIn(lower).flatMap(_.toIntOption).getOrElse(Int.MaxValue)
    (level, lower)

  def defaultTag(name: Tag) = VideoTag(name, "", Int.MaxValue, Nil)

enum VideoSort(val key: String):
  case Curated extends VideoSort("curated")
  case Uploaded extends VideoSort("uploaded")
  case UploadedOldest extends VideoSort("oldest")
  case Views extends VideoSort("views")
  case Title extends VideoSort("title")

object VideoSort:
  def byKey(key: String): VideoSort = values.find(_.key == key).getOrElse(Curated)

case class VideoSection(tag: VideoTag, videos: Seq[VideoView], total: Int)
