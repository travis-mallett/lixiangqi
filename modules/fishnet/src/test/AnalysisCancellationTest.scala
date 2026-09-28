package lila.fishnet

import scala.concurrent.Await
import org.apache.pekko.actor.ActorSystem
import reactivemongo.api.AsyncDriver
import lila.db.dsl.{ *, given }

class AnalysisCancellationTest extends munit.FunSuite:
  if sys.env.contains("LIXIANGQI_ANALYSIS_TEST_URI") then
    test("completion cancels queued and acquired native requests while retaining other work"):
      given Executor = scala.concurrent.ExecutionContext.global
      given system: ActorSystem = ActorSystem("analysis-cancellation-test")
      given Scheduler = system.scheduler
      given play.api.Mode = play.api.Mode.Test
      val driver = new AsyncDriver()
      def waitFor[A](future: Fu[A]): A = Await.result(future, 30.seconds)
      try
        val connection = waitFor(driver.connect(sys.env("LIXIANGQI_ANALYSIS_TEST_URI")))
        val database = waitFor(
          connection.database(
            "analysis_cancellation_test_" + java.util.UUID.randomUUID().toString.replace("-", "")
          )
        )
        try
          val queue = database.collection[Coll]("queue")
          val repo = new FishnetRepo(queue, database.collection[Coll]("clients"), new lila.memo.CacheApi)
          waitFor(queue.insert.one($doc("_id" -> "queued", "game" -> $doc("id" -> "native01"))))
          waitFor(
            queue.insert.one(
              $doc(
                "_id" -> "acquired",
                "game" -> $doc("id" -> "native01"),
                "acquired" -> $doc("by" -> "worker")
              )
            )
          )
          waitFor(
            queue.insert.one(
              $doc("_id" -> "study", "game" -> $doc("id" -> "native01", "studyId" -> "study01"))
            )
          )
          waitFor(queue.insert.one($doc("_id" -> "other", "game" -> $doc("id" -> "native02"))))
          waitFor(repo.cancelGame(GameId("native01")))
          assertEquals(waitFor(queue.primitive[String]($empty, "_id")).toSet, Set("study", "other"))
          assertEquals(waitFor(repo.getAnalysis(Work.Id("acquired"))), None)
          waitFor(repo.cancelGame(GameId("native01")))
          assertEquals(waitFor(queue.countAll), 2L)
        finally waitFor(database.drop())
      finally
        waitFor(driver.close())
        waitFor(system.terminate())
