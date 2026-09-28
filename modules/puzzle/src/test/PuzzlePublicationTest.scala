package lila.puzzle

import play.api.libs.json.*
import scala.concurrent.Await
import scala.concurrent.duration.*
import reactivemongo.api.AsyncDriver
import lila.db.AsyncColl
import lila.db.dsl.{ *, given }
import lila.core.config.CollName

class PuzzlePublicationTest extends munit.FunSuite:
  import PuzzlePublicationJson.*
  private val content = Json.obj(
    "_id" -> "Live1",
    "gameId" -> "source1",
    "gameSource" -> Json.obj("type" -> "catalog", "database" -> "fixture"),
    "fen" -> lila.xiangqi.Xiangqi.startFen,
    "line" -> "a4a5 a7a6",
    "playback" -> Json.obj("objective" -> "mate", "solutions" -> List(List("a7a6"))),
    "themes" -> List("mateIn1"),
    "retired" -> false,
    "sourceSnapshot" -> Json.obj(
      "initialFen" -> lila.xiangqi.Xiangqi.startFen,
      "moves" -> List("a4a5", "a7a6"),
      "players" -> List.empty[String]
    )
  )
  test("authored boundary rejects user data and requires source snapshot"):
    assertEquals(puzzle(content), normalized(content))
    intercept[Invalid](puzzle(content ++ Json.obj("plays" -> 42)))
    intercept[Invalid](puzzle(content - "sourceSnapshot"))
    intercept[Invalid](puzzle(content ++ Json.obj("retired" -> true)))

  test("double cannons is visible and accepted for publication"):
    assert(PuzzleTheme.visible.contains(PuzzleTheme.doubleCannons))
    val themed = content ++ Json.obj("themes" -> List("doubleCannons", "mateIn1"))
    assertEquals(puzzle(themed), normalized(themed))

  test("white faced general is visible and accepted for publication"):
    assert(PuzzleTheme.visible.contains(PuzzleTheme.whiteFacedGeneral))
    val themed = content ++ Json.obj("themes" -> List("whiteFacedGeneral", "mateIn1"))
    assertEquals(puzzle(themed), normalized(themed))

  test("double chariots is visible and accepted for publication"):
    assert(PuzzleTheme.visible.contains(PuzzleTheme.doubleChariotsMate))
    val themed = content ++ Json.obj("themes" -> List("doubleChariotsMate", "mateIn1"))
    assertEquals(puzzle(themed), normalized(themed))

  test("canonical numbers have cross-language stable digests"):
    assertEquals(canonical(Json.parse("{\"z\":1.0,\"a\":[1e-7,-0.0]}")), "{\"a\":[0.0000001,0],\"z\":1}")

  if sys.env.contains("LIXIANGQI_PUBLICATION_TEST_URI") then
    test(
      "live Mongo publication, concurrent activity, conflicts and restart recovery".tag(
        new munit.Tag("publicationMongo")
      )
    ):
      val uri = sys.env("LIXIANGQI_PUBLICATION_TEST_URI")
      given Executor = scala.concurrent.ExecutionContext.global
      val driver = new AsyncDriver()
      def waitFor[A](f: Fu[A]): A = Await.result(f, 30.seconds)
      val connection = waitFor(driver.connect(uri))
      val database = waitFor(
        connection.database(
          "puzzle_publication_test_" + java.util.UUID.randomUUID().toString.replace("-", "")
        )
      )
      def coll(name: String) = new AsyncColl(CollName(name), () => fuccess(database.collection[Coll](name)))
      val puzzles = coll("puzzle")
      val journal = coll("publication")
      val colls = new PuzzleColls(puzzles, coll("round"), coll("path"), journal)
      def service = new PuzzlePublication(colls, journal)
      def request(id: String, p: JsObject, before: Option[JsObject] = None, revision: Option[String] = None) =
        val changes = Json.arr(
          Json.obj(
            "puzzle" -> p,
            "expectedDigest" -> before.map(digest),
            "expectedRevision" -> revision,
            "provenance" -> Json.obj("status" -> "verified", "assessmentId" -> 1)
          )
        )
        Json.obj(
          "operationId" -> id,
          "digest" -> digest(Json.obj("changes" -> changes)),
          "changes" -> changes
        )
      def finish(api: PuzzlePublication, id: String): JsObject =
        var result = waitFor(api.receipt(id)).get
        var retries = 0
        while str(result, "status") != "visible" && str(result, "status") != "conflict" && retries < 20 do
          waitFor(api.recover())
          result = waitFor(api.receipt(id)).get
          retries += 1
        result
      try
        val p = normalized(content)
        val first = "publication-add-0001"
        val api = service
        val add = request(first, p)
        waitFor(api.submit(add, UserId("operator")))
        assertEquals(str(finish(api, first), "status"), "visible")
        waitFor(api.submit(add, UserId("operator")))
        assertEquals(waitFor(puzzles(_.countSel($empty))), 1)
        val paths = waitFor(colls.path(_.countSel($empty)))
        assert(paths > 0)
        val original = waitFor(puzzles(_.byId[Bdoc]("Live1"))).get
        assertEquals(authored(original), p)
        // These are the same field-level writes made by live solve/vote/tag writers.
        waitFor(
          puzzles(
            _.update.one(
              $id("Live1"),
              $set("plays" -> 51, "vote" -> 0.7, "glicko.r" -> 1890d) ++ $addToSet(
                "themes" -> "fork",
                "communityThemes" -> "fork"
              )
            )
          )
        )
        waitFor(colls.round(_.insert.one($doc("_id" -> "player:Live1", "win" -> true))))
        val retired = p ++ Json.obj("retired" -> true, "retirementReason" -> "audit")
        val second = "publication-retire-0002"
        waitFor(api.submit(request(second, retired, Some(p), Some(first)), UserId("operator")))
        // A fresh service instance recovers the database journal after a restart.
        val restarted = service
        val writes = (1 to 20).map(_ => puzzles(_.update.one($id("Live1"), $inc("plays" -> 1))))
        assertEquals(str(finish(restarted, second), "status"), "visible")
        waitFor(Future.sequence(writes))
        val after = waitFor(puzzles(_.byId[Bdoc]("Live1"))).get
        assertEquals(after.int("plays"), Some(71))
        assertEquals(after.getAsOpt[List[String]]("themes"), Some(List("fork", "mateIn1")))
        assertEquals(after.getAsOpt[Bdoc]("glicko").flatMap(_.getAsOpt[Double]("r")), Some(1890d))
        assertEquals(waitFor(colls.round(_.countSel($empty))), 1)
        assertEquals(waitFor(puzzles(_.countSel(Puzzle.activeSelector))), 0)
        assertEquals(authored(after), retired)
        assert(waitFor(journal(_.byId[Bdoc](second))).get.string("plan").exists(_.contains("before")))
        val conflict = "publication-conflict-0003"
        waitFor(api.submit(request(conflict, p, Some(p), Some(first)), UserId("operator")))
        assertEquals(str(finish(api, conflict), "status"), "conflict")
        assertEquals(authored(waitFor(puzzles(_.byId[Bdoc]("Live1"))).get), retired)
        intercept[Invalid](waitFor(api.submit(request(first, retired), UserId("operator"))))
        // Cut database access at successive boundaries, including journal
        // preparation, content writes, page staging, and pointer activation.
        // Recovery uses a fresh instance and the same durable request.
        for boundary <- 1 to 35 do
          val operation = s"interrupted-operation-$boundary"
          val authoredPuzzle =
            p ++ Json.obj("_id" -> f"F$boundary%04d", "gameId" -> s"fault-source-$boundary")
          val upload = request(operation, authoredPuzzle)
          waitFor(
            journal(
              _.insert.one(
                $id(operation) ++ $doc(
                  "request" -> canonical(upload),
                  "digest" -> str(upload, "digest"),
                  "status" -> "submitted",
                  "createdAt" -> nowInstant
                )
              )
            )
          )
          val calls = new java.util.concurrent.atomic.AtomicInteger(0)
          def failing(c: AsyncColl) = new AsyncColl(
            c.name,
            () => if calls.incrementAndGet() >= boundary then fufail("injected connection loss") else c.get
          )
          val interrupted = new PuzzlePublication(
            new PuzzleColls(failing(puzzles), colls.round, failing(colls.path), failing(journal)),
            failing(journal)
          )
          waitFor(interrupted.recover().recover { case _: Exception => () })
          val recovered = service
          assertEquals(str(finish(recovered, operation), "status"), "visible", clues(boundary))
          waitFor(recovered.submit(upload, UserId("operator")))
          assertEquals(
            authored(waitFor(puzzles(_.byId[Bdoc](str(authoredPuzzle, "_id")))).get),
            authoredPuzzle
          )
        assertEquals(waitFor(puzzles(_.countSel($empty))), 36)
      finally
        waitFor(database.drop())
        waitFor(driver.close())
