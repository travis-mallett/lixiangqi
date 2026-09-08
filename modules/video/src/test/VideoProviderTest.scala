package lila.video

import java.time.Instant

import reactivemongo.api.bson.BSONDocument

class VideoProviderTest extends munit.FunSuite:

  test("parse common YouTube URLs"):
    val id = "dQw4w9WgXcQ"
    List(
      id,
      s"https://www.youtube.com/watch?v=$id&t=42",
      s"https://youtu.be/$id",
      s"https://youtube.com/embed/$id",
      s"https://www.youtube.com/shorts/$id",
      s"https://www.youtube.com/live/$id"
    ).foreach: input =>
      assertEquals(YoutubeProvider.parse(input).map(_.externalId), Some(id))

  test("reject malformed and lookalike YouTube URLs"):
    List(
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=too-short",
      "javascript:alert(1)"
    ).foreach(input => assertEquals(YoutubeProvider.parse(input), None))

  test("parse Bilibili URLs and IDs"):
    val id = "BV1xx411c7mD"
    List(
      id,
      s"https://www.bilibili.com/video/$id/",
      s"https://m.bilibili.com/video/$id?share_source=copy_web"
    ).foreach: input =>
      assertEquals(BilibiliProvider.parse(input).map(_.externalId), Some(id))

  test("reject malformed and lookalike Bilibili URLs"):
    List(
      "https://example.com/video/BV1xx411c7mD",
      "https://notbilibili.com/video/BV1xx411c7mD",
      "https://bilibili.com/video/not-a-bvid",
      "https://bilibili.example/video/BV1xx411c7mD"
    ).foreach(input => assertEquals(BilibiliProvider.parse(input), None))

  test("normalize tags for reliable filtering"):
    val data = VideoForm.Data(
      sourceUrl = "https://youtu.be/dQw4w9WgXcQ",
      title = "Title",
      author = "Author",
      description = None,
      targets = List(Target.BEGINNER),
      tags = " Opening, Strategy; opening\nENDGAME ",
      lang = "en",
      ads = false,
      startTime = 0,
      status = VideoStatus.Draft.key
    )
    assertEquals(data.normalizedTags, List("opening", "strategy", "endgame"))

  test("read legacy YouTube documents during migration"):
    import BsonHandlers.given
    val createdAt = Instant.parse("2025-01-02T03:04:05Z")
    val legacy = BSONDocument(
      "_id" -> "dQw4w9WgXcQ",
      "title" -> "Legacy title",
      "author" -> "Legacy author",
      "targets" -> List(Target.BEGINNER),
      "tags" -> List("opening"),
      "lang" -> "en",
      "ads" -> false,
      "startTime" -> 0,
      "metadata" -> BSONDocument("description" -> "Description", "duration" -> 42),
      "createdAt" -> createdAt
    )
    val video = legacy.asOpt[Video].getOrElse(fail("Legacy video did not decode"))
    assertEquals(video.source.provider, VideoProvider.Youtube)
    assertEquals(video.source.externalId, "dQw4w9WgXcQ")
    assertEquals(video.status, VideoStatus.Published)
    assertEquals(video.sortOrder, Int.MaxValue)
    assertEquals(video.updatedAt, createdAt)
