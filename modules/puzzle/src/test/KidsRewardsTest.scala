package lila.puzzle

import play.api.libs.json.*
import scala.concurrent.Await
import reactivemongo.api.AsyncDriver

import lila.db.AsyncColl
import lila.db.dsl.{ *, given }
import lila.core.config.CollName

class KidsRewardsTest extends munit.FunSuite:
  test("Jiangnan arrival gifts are awarded once at levels 6, 12 and 16"):
    List(
      0L -> 0L,
      2L -> 0L,
      3L -> 1L,
      14L -> 4L,
      15L -> 6L,
      32L -> 11L,
      33L -> 15L,
      44L -> 18L,
      45L -> 24L,
      48L -> 25L
    ).foreach: (coins, expected) =>
      assertEquals(KidsRewards.ingots(coins), expected)

  test("a successful retry carries a reward without changing the original rated loss"):
    val value = Json
      .obj("id" -> "abcde", "win" -> false, "rated" -> true, "solved" -> true)
      .as[PuzzleForm.batch.Solution]
    assert(!value.win.yes)
    assertEquals(value.solved, Some(true))
    val legacy = Json
      .obj("id" -> "abcde", "win" -> true, "rated" -> true)
      .as[PuzzleForm.batch.Solution]
    assertEquals(legacy.solved, None)

  if sys.env.contains("LIXIANGQI_REWARDS_TEST_URI") then
    test("Mongo receipts survive retries, concurrency, service recreation and account changes"):
      given Executor = scala.concurrent.ExecutionContext.global
      val driver = new AsyncDriver()
      def waitFor[A](f: Fu[A]): A = Await.result(f, 30.seconds)
      val connection = waitFor(driver.connect(sys.env("LIXIANGQI_REWARDS_TEST_URI")))
      val database = waitFor(
        connection.database("kids_rewards_test_" + java.util.UUID.randomUUID().toString.replace("-", ""))
      )
      val coll = new AsyncColl(CollName("receipts"), () => fuccess(database.collection[Coll]("receipts")))
      def service = new KidsRewards(coll, id => fuccess(id != PuzzleId("invalid")))
      val user = UserId("kid-a")
      val other = UserId("kid-b")
      def round(id: String) =
        PuzzleRound(PuzzleRound.Id(user, PuzzleId(id)), PuzzleWin(false), None, nowInstant)
      try
        assertEquals(waitFor(service.earned(user)), 0L)
        waitFor(Future.sequence(List.fill(12)(service.award(user, List(round("first"))))))
        assertEquals(waitFor(service.earned(user)), 1L)
        waitFor(service.award(user, List(round("second"), round("invalid"))))
        assertEquals(waitFor(service.earned(user)), 2L)
        assertEquals(waitFor(service.earned(other)), 0L)
        waitFor(service.award(other, List(round("first"))))
        assertEquals(waitFor(service.earned(other)), 1L)
        waitFor(service.award(user, List(round("third"))))
        assertEquals(waitFor(service.earned(user)), 3L)
        assertEquals(waitFor(coll(_.countSel($empty))), 4)
      finally
        waitFor(database.drop())
        waitFor(driver.close())
