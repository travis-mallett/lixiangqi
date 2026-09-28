package lila.traffic

import java.time.Instant
import scala.concurrent.Await
import reactivemongo.api.AsyncDriver
import lila.db.dsl.{ *, given }

class TrafficPipelineTest extends munit.FunSuite:
  override val munitTimeout = scala.concurrent.duration.Duration(120, "seconds")

  if sys.env.contains("LIXIANGQI_TRAFFIC_TEST_URI") then
    test("journal replay, transaction rollback, late events, cohorts and erasure survive restart"):
      given Executor = scala.concurrent.ExecutionContext.global
      val driver = new AsyncDriver()
      def waitFor[A](f: Fu[A]): A = Await.result(f, 40.seconds)
      val name = "traffic_test_" + java.util.UUID.randomUUID().toString.replace("-", "")
      val uri = sys.env("LIXIANGQI_TRAFFIC_TEST_URI").stripSuffix("/") + "/" + name
      val store = TrafficStore(lila.db.AsyncDb("traffic-test", uri, driver))
      val identity = TrafficIdentity("traffic-integration-test-secret-0123456789")
      val alice = identity("account", "alice")
      val bob = identity("account", "bob")
      val at = Instant.parse("2015-01-14T10:00:00Z")
      def event(
          id: String,
          subject: String,
          time: Instant = at,
          kind: String = "page",
          attempt: Option[String] = None
      ) =
        StoredEvent(
          id,
          kind,
          time,
          java.time.Instant.now(),
          subject,
          true,
          s"browser-$subject",
          "session-test",
          s"visit-$id",
          attempt,
          Map("page" -> "Puzzle.show", "board" -> lila.pref.BoardThemes.all.head.key, "pool" -> "15+0"),
          Map.empty
        )
      def processor = TrafficProcessor(store)
      val query = TrafficQuery(store)
      val filter = TrafficFilter(
        TrafficTime.bucket(at, "day"),
        TrafficTime.bucket(at, "day").plusSeconds(86400 * 3),
        "day",
        "all",
        None,
        None
      )
      try
        val collections = List(
          store.events,
          store.rollups,
          store.facts,
          store.attempts,
          store.state,
          store.snapshots,
          store.catalog,
          store.browsers,
          store.subjects,
          store.erasures,
          store.rebuilds,
          store.games
        )
        collections.foreach(c => waitFor(c(_.create())))
        intercept[Exception](waitFor(store.ready)) // an unavailable startup schema must be retryable
        waitFor(store.state(_.insert.one($doc("_id" -> "schema", "version" -> 1))))
        val original =
          List(event("one", alice), event("two", alice, at.plusSeconds(86400)), event("three", bob))
        waitFor(store.append(original))
        waitFor(store.append(original))
        assertEquals(waitFor(store.events(_.countSel($empty))), 3)
        val crash =
          store.transaction(db => processor.process(db).flatMap(_ => fufail[Unit]("crash before commit")))
        intercept[Exception](waitFor(crash))
        assertEquals(waitFor(store.rollups(_.countSel($empty))), 0)
        assertEquals(waitFor(store.events(_.countSel($doc("processed" -> false)))), 3)
        waitFor(Future.sequence(List.fill(2)(processor.run().recover { case _ => () })))
        waitFor(processor.run())
        val first = waitFor(query.report(filter))
        assertEquals((first \ "summary" \ "counts" \ "page").as[Long], 3L)
        assertEquals((first \ "summary" \ "visitors").as[Long], 2L)
        val attempt = "search-attempt-1"
        waitFor(
          store.append(
            List(
              event("paired", alice, at.plusSeconds(120), "search.paired", Some(attempt))
                .copy(dimensions = Map("pool" -> "15+0", "game" -> "test-game")),
              event("accepted", alice, at, "search.accepted", Some(attempt)),
              event("first-move", "system", at.plusSeconds(125), "game.firstMove")
                .copy(registered = false, dimensions = Map("game" -> "test-game")),
              event("historical-signup", bob, Instant.parse("2014-01-01T00:00:00Z"), "user.registered")
            )
          )
        )
        waitFor(processor.run())
        val cohort = waitFor(TrafficCohorts(store).searches(filter))
        assertEquals((cohort \ "accepted").as[Int], 1)
        assertEquals((cohort \ "paired").as[Int], 1)
        assertEquals((cohort \ "waitP50").as[Long], 120000L)
        assertEquals((cohort \ "firstMove").as[Int], 1)
        query.invalidate()
        val anonymous = waitFor(query.report(filter.copy(registered = Some(false))))
        assertEquals((anonymous \ "summary" \ "counts" \ "game_firstMove").asOpt[Long], None)
        val registered = waitFor(query.report(filter.copy(registered = Some(true))))
        assertEquals((registered \ "registrationBaseline").as[Long], 1L)
        waitFor(TrafficErasure(store, identity, processor).request(UserId("alice")))
        intercept[Exception](waitFor(store.reportsReady))
        var work = true
        var iterations = 0
        while work && iterations < 40 do
          work = waitFor(TrafficErasure(store, identity, processor).step())
          iterations += 1
        assert(!work, "bounded rebuild must finish")
        waitFor(store.append(original.take(2))) // census/retry cannot restore erased subjects
        waitFor(processor.run())
        query.invalidate()
        val after = waitFor(query.report(filter))
        assertEquals((after \ "summary" \ "counts" \ "page").as[Long], 1L)
        assertEquals((after \ "summary" \ "visitors").as[Long], 1L)
        assertEquals(waitFor(store.events(_.countSel($doc("subject" -> alice)))), 0)
        assertEquals(waitFor(store.facts(_.countSel($doc("subject" -> alice)))), 0)
        assertEquals(waitFor(store.attempts(_.countSel($doc("subject" -> alice)))), 0)
        assertEquals(waitFor(store.browsers(_.countSel($doc("subject" -> alice)))), 0)
        assertEquals(waitFor(store.subjects(_.countSel($id(alice)))), 0)
        // Exercise a full minute batch with the real catalog and typical breakdown fan-out.
        val catalog = TrafficCatalog.choices.map((component, options) => component -> options.keys.head)
        val burst = (1 to 100).toList.map: index =>
          event(
            s"burst-$index",
            identity("account", s"burst-user-$index"),
            Instant.parse("2020-01-01T10:00:00Z"),
            "attention"
          ).copy(
            dimensions = catalog ++ Map(
              "page" -> "Puzzle.show",
              "activity" -> "puzzle.solve",
              "country" -> "US",
              "region" -> "US/California",
              "city" -> s"US/California/City$index",
              "language" -> "en",
              "device" -> "desktop",
              "theme" -> "mix",
              "musicEnabled" -> "true",
              "effectsEnabled" -> "true"
            ),
            values =
              Map("visibleMs" -> 60000L, "engagedMs" -> 60000L, "boardMs" -> 60000L, "solvingMs" -> 60000L)
          )
        waitFor(store.append(burst))
        val started = System.nanoTime()
        waitFor(processor.run())
        println(
          s"Traffic integration: 100 full attention events materialized in ${(System.nanoTime() - started) / 1000000} ms"
        )
        val burstFilter = TrafficFilter(
          Instant.parse("2020-01-01T00:00:00Z"),
          Instant.parse("2020-01-02T00:00:00Z"),
          "hour",
          "all",
          None,
          None
        )
        val burstReport = waitFor(query.report(burstFilter))
        assertEquals((burstReport \ "summary" \ "counts" \ "engagedMs").as[Long], 6000000L)
        val privateCity = waitFor(query.report(burstFilter.copy(dimension = "city")))
        assertEquals((privateCity \ "groups").as[List[play.api.libs.json.JsObject]].size, 0)
        assert((privateCity \ "smallCellsSuppressed").as[Boolean])
      finally
        val db = waitFor(store.events.get).db
        assert(db.name.startsWith("traffic_test_"))
        waitFor(db.drop())
        waitFor(driver.close())
