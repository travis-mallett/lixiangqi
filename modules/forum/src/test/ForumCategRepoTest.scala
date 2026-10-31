package lila.forum

import scala.concurrent.Await
import org.apache.pekko.actor.ActorSystem
import reactivemongo.api.AsyncDriver

import lila.db.dsl.{ *, given }

class ForumCategRepoTest extends munit.FunSuite:
  import BSONHandlers.given

  if sys.env.contains("LIXIANGQI_FORUM_TEST_URI") then
    test("empty database provisioning, concurrent first use, and restart preserve category data"):
      given Executor = scala.concurrent.ExecutionContext.global
      given system: ActorSystem = ActorSystem("forum-categ-test")
      given Scheduler = system.scheduler
      given play.api.Mode = play.api.Mode.Test
      val cache = new lila.memo.CacheApi
      val driver = new AsyncDriver()
      def waitFor[A](f: Fu[A]): A = Await.result(f, 30.seconds)
      val connection = waitFor(driver.connect(sys.env("LIXIANGQI_FORUM_TEST_URI")))
      val db =
        waitFor(connection.database("forum_test_" + java.util.UUID.randomUUID().toString.replace("-", "")))
      val coll: Coll = db.collection("f_categ")
      try
        val repo = new ForumCategRepo(coll, cache)
        val concurrentRepo = new ForumCategRepo(coll, new lila.memo.CacheApi)
        val board = ForumCateg.publicBoards.head
        val results = waitFor((1 to 8).toList.parallel: n =>
          (if n % 2 == 0 then repo else concurrentRepo).byId(board.id))
        assert(results.forall(_.contains(board)))
        assertEquals(
          waitFor(repo.visibleWithTeams(Nil, None)).map(_.id).toSet,
          ForumCateg.publicBoards.map(_.id).toSet
        )
        assert(waitFor(repo.byId(ForumCateg.diagnosticId)).exists(c => c.hidden && c.quiet))
        assert(waitFor(repo.byId(ForumCateg.ublogId)).exists(_.hidden))

        val populated = board.copy(
          name = "Existing title",
          nbTopics = 2,
          nbPosts = 7,
          nbTopicsTroll = 3,
          nbPostsTroll = 9,
          lastPostId = ForumPostId("existing"),
          lastPostIdTroll = ForumPostId("shadow")
        )
        waitFor(coll.update.one($id(board.id), populated))
        val team =
          board.copy(id = ForumCateg.fromTeamId(TeamId("test-team")), team = Some(TeamId("test-team")))
        waitFor(coll.insert.one(team))
        // Retry after a partial provisioning run must fill gaps without resetting other records.
        waitFor(coll.delete.one($id(ForumCateg.publicBoards.last.id)))
        // A new process must not reset counters, last-post references, or custom metadata.
        val restarted = new ForumCategRepo(coll, new lila.memo.CacheApi)
        assertEquals(waitFor(restarted.byId(board.id)), Some(populated))
        assertEquals(waitFor(restarted.byId(team.id)), Some(team))
        assertEquals(waitFor(coll.countSel($empty)), ForumCateg.siteBoards.size + 1)
      finally
        waitFor(db.drop())
        waitFor(driver.close())
        waitFor(system.terminate())
