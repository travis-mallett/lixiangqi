package lila.analyse

import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.adjudication.Ruleset

class ExternalEngineBrokerTest extends munit.FunSuite:
  import ExternalEngineBroker.*
  private val engine = ExternalEngine(
    "eei_test00000001",
    "Pikafish",
    2,
    128,
    "xiangqi-v1",
    true,
    "selector",
    None,
    UserId("owner"),
    "client-secret"
  )
  private val work =
    Work("session", 16, 1024, 2, Xiangqi.startFen, Vector.empty, Ruleset.Unrestricted, Some(20), None, None)

  test("native searches clamp provider resources and retain literal full history"):
    val moves = Vector("a4a5", "i10i9").map(Xiangqi.Uci.unsafe)
    val result = validate(work.copy(moves = moves), engine).toOption.get
    assertEquals(result._1.threads, 2)
    assertEquals(result._1.hash, 128)
    assertEquals(result._2.moves, moves)
    assertEquals(result._2.ruleset, Ruleset.Unrestricted)

  test("invalid budgets and illegal history are explicit errors"):
    assert(validate(work.copy(depth = None), engine).isLeft)
    assert(validate(work.copy(nodes = Some(1)), engine).isLeft)
    assert(validate(work.copy(multiPv = 0), engine).isLeft)
    assert(validate(work.copy(moves = Vector(Xiangqi.Uci.unsafe("a1a10"))), engine).isLeft)

  test("provider updates require complete legal native variations"):
    val game = Xiangqi.Game.initial
    val good = Analysis(
      100,
      12,
      500,
      List(Pv(List(Xiangqi.Uci.unsafe("h3e3"), Xiangqi.Uci.unsafe("i10i9")), Some(15), None))
    )
    assertEquals(validateAnalysis(good, game, 2), Right(()))
    assert(
      validateAnalysis(
        good.copy(pvs =
          good.pvs.map(_.copy(moves = List(Xiangqi.Uci.unsafe("h3e3"), Xiangqi.Uci.unsafe("a10a1"))))
        ),
        game,
        2
      ).isLeft
    )
    assert(validateAnalysis(good.copy(pvs = good.pvs ++ good.pvs), game, 2).isLeft)
    assert(validateAnalysis(good.copy(pvs = good.pvs.map(_.copy(mate = Some(1)))), game, 2).isLeft)

  test("terminal native positions are not sent for an engine search"):
    val terminal = "4k4/9/9/9/9/9/3R5/4R4/9/5K3 b - - 0 1"
    assert(XiangqiRules.position(Xiangqi.Position(terminal)).toOption.get.ended)
    assert(validate(work.copy(initialFen = terminal), engine).isLeft)

  if sys.env.contains("LIXIANGQI_ANALYSIS_TEST_URI") then
    test("native broker authenticates providers, streams validated results, and isolates client secrets"):
      import scala.concurrent.Await
      import org.apache.pekko.actor.ActorSystem
      import org.apache.pekko.stream.scaladsl.Sink
      import reactivemongo.api.AsyncDriver
      import lila.db.dsl.{ *, given }
      import AnalyseBsonHandlers.given
      given Executor = scala.concurrent.ExecutionContext.global
      given system: ActorSystem = ActorSystem("native-engine-broker-test")
      given Scheduler = system.scheduler
      given org.apache.pekko.stream.Materializer =
        org.apache.pekko.stream.SystemMaterializer(system).materializer
      given play.api.Mode = play.api.Mode.Test
      val driver = new AsyncDriver()
      def waitFor[A](future: Fu[A]): A = Await.result(future, 20.seconds)
      val connection = waitFor(driver.connect(sys.env("LIXIANGQI_ANALYSIS_TEST_URI")))
      val database = waitFor(
        connection.database("native_engine_test_" + java.util.UUID.randomUUID().toString.replace("-", ""))
      )
      val coll = database.collection[Coll]("external_engine")
      val secret = "private-provider-secret"
      val registered = engine.copy(providerSelector = ExternalEngine.selector(secret))
      try
        waitFor(coll.insert.one(registered))
        val api = ExternalEngineApi(coll, lila.memo.CacheApi())
        val broker = ExternalEngineBroker(api)
        assertEquals(
          waitFor(broker.analyse(engine._id, Request("wrong", work))).left.toOption.map(_.status),
          Some(403)
        )
        val stream = waitFor(broker.analyse(engine._id, Request(engine.clientSecret, work))).toOption.get
        val sink = stream.runWith(Sink.queue())
        assertEquals(broker.acquire("other-provider-secret"), Right(None))
        val acquired = broker.acquire(secret).toOption.flatten.get
        val id = (acquired \ "id").as[String]
        val token = (acquired \ "secret").as[String]
        assertEquals((acquired \ "work" \ "initialFen").as[String], Xiangqi.startFen)
        assertEquals(broker.acquire(secret), Right(None))
        val analysis = Analysis(200, 12, 500, List(Pv(List(Xiangqi.Uci.unsafe("h3e3")), Some(15), None)))
        assert(broker.submit(id, Update("wrong", Some(analysis), true, None)).isLeft)
        assertEquals(broker.submit(id, Update(token, Some(analysis), true, None)), Right(()))
        assertEquals((waitFor(sink.pull()).get \ "depth").as[Int], 12)
        assertEquals(waitFor(sink.pull()), None)
        assert(broker.submit(id, Update(token, Some(analysis), true, None)).isLeft)
      finally
        waitFor(database.drop())
        waitFor(driver.close())
        waitFor(system.terminate())
