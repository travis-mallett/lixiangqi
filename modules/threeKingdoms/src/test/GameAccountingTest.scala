package lila.threeKingdoms

import scala.concurrent.Await
import reactivemongo.api.AsyncDriver
import lila.db.dsl.{ *, given }

class GameAccountingTest extends munit.FunSuite:
  override val munitTimeout = scala.concurrent.duration.Duration(120, "seconds")

  if sys.env.contains("LIXIANGQI_THREE_KINGDOMS_TEST_URI") then
    for rated <- List(false, true) do
      test(s"concurrent settlement counts each friend game once (rated=$rated)"):
        given Executor = scala.concurrent.ExecutionContext.global
        val driver = new AsyncDriver()
        def waitFor[A](f: Fu[A]): A = Await.result(f, 40.seconds)
        val name = "three_kingdoms_test_" + java.util.UUID.randomUUID().toString.replace("-", "")
        val uri = sys.env("LIXIANGQI_THREE_KINGDOMS_TEST_URI").stripSuffix("/") + "/" + name
        val connection = waitFor(reactivemongo.api.MongoConnection.fromString(uri).flatMap(driver.connect(_)))
        val db = waitFor(connection.database(name))
        val games = GameRepo(db.collection("games"))
        val users: Coll = db.collection("users")
        val accounting = GameAccounting(games, new lila.user.UserRepo(users))
        val ids = Vector(UserId("wei"), UserId("wu"), UserId("shu"))
        val now = java.time.Instant.now()
        val initial = KingdomGame(
          GameId("testgame"),
          ids.map(id =>
            Seat(Some(id), None, Option.when(rated)(lila.rating.ThreeKingdomsRank.initialSnapshot))
          ),
          Position.initial,
          Position.initial,
          ClockState.start(ClockConfig(), now.toEpochMilli),
          now,
          now,
          rated = rated
        )
        val finished = initial
          .resign(ids(1), now.toEpochMilli)
          .toOption
          .get
          .resign(ids(0), now.toEpochMilli)
          .toOption
          .get
        try
          waitFor(games.coll.create())
          waitFor(users.create())
          ids.foreach(id => waitFor(users.insert.one($id(id))))
          waitFor(games.insert(finished))
          waitFor(Future.sequence(List.fill(2)(accounting.finish(finished))))
          waitFor(accounting.finish(finished))
          for (id, index) <- ids.zipWithIndex do
            val user = waitFor(users.byId[Bdoc](id)).get
            val counts = user.getAsOpt[Bdoc]("count").get
            assertEquals(counts.int("game"), Some(1))
            assertEquals(counts.int("rated").getOrElse(0), if rated then 1 else 0)
            assertEquals(counts.int(if index == 2 then "win" else "loss"), Some(1))
          assertEquals(
            waitFor(games.coll.byId[Bdoc](finished.id)).get.getAsOpt[Boolean]("accounted"),
            Some(true)
          )
        finally
          assert(db.name.startsWith("three_kingdoms_test_"))
          waitFor(db.drop())
          waitFor(driver.close())
