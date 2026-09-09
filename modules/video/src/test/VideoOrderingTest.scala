package lila.video

class VideoOrderingTest extends munit.FunSuite:
  private def video(id: String, created: Long, uploaded: Option[Long] = None, order: Int = 0) =
    val date = java.time.Instant.ofEpochMilli(created)
    Video(
      _id = id,
      source = VideoSource(VideoProvider.Youtube, id, s"https://youtu.be/$id"),
      title = id,
      author = "Author",
      description = None,
      targets = Nil,
      tags = List("tag"),
      lang = "en",
      ads = false,
      startTime = 0,
      status = VideoStatus.Published,
      sortOrder = order,
      metadata = VideoMetadata.empty.copy(publishedAt = uploaded.map(java.time.Instant.ofEpochMilli)),
      createdAt = date,
      createdBy = None,
      updatedAt = date,
      updatedBy = None
    )

  test("curated ordering appends new videos and ignores removed IDs"):
    val videos = List(video("a", 1), video("b", 2), video("c", 3))
    assertEquals(
      VideoOrdering(videos, VideoSort.Curated, List("removed", "a")).map(_.id),
      List("a", "c", "b")
    )

  test("unspecified curated ordering matches global order with deterministic ties"):
    val videos = List(video("b", 1), video("a", 1), video("c", 3), video("d", 4, order = 1))
    assertEquals(VideoOrdering(videos, VideoSort.Curated).map(_.id), List("c", "a", "b", "d"))

  test("upload sorting places unknown dates last and breaks ties by ID"):
    val videos = List(video("c", 2), video("b", 9, Some(2)), video("a", 9, Some(1)))
    assertEquals(VideoOrdering(videos, VideoSort.Uploaded).map(_.id), List("b", "a", "c"))
    assertEquals(VideoOrdering(videos, VideoSort.UploadedOldest).map(_.id), List("a", "b", "c"))

  test("view sorting includes unseen videos deterministically"):
    val videos = List(video("c", 1), video("b", 1), video("a", 1))
    assertEquals(VideoOrdering(videos, VideoSort.Views, views = Map("b" -> 4)).map(_.id), List("b", "a", "c"))
