package lila.memo

class PicfitUploadTest extends munit.FunSuite:
  given Executor = scala.concurrent.ExecutionContextOpportunistic

  test("a failed byte upload preserves metadata and the previous image; retry stores again"):
    val events = scala.collection.mutable.ListBuffer.empty[String]
    var failStore = true
    def upload = PicfitApi.commitUpload(
      {
        events += "store"
        if failStore then fufail[Unit]("offline") else funit
      },
      { events += "record"; fuccess("image") },
      { events += "release"; funit }
    )
    upload.failed.flatMap: _ =>
      assertEquals(events.toList, List("store"))
      failStore = false
      upload.map: result =>
        assertEquals(result, "image")
        assertEquals(events.toList, List("store", "store", "record", "release"))

  test("a failed metadata write does not detach the previous image"):
    var released = false
    PicfitApi
      .commitUpload(
        funit,
        fufail[String]("database unavailable"), {
          released = true; funit
        }
      )
      .failed
      .map: _ =>
        assert(!released)
