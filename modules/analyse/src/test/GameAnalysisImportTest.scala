package lila.analyse

import chess.{ ByColor, Ply }
import chess.eval.Eval.Cp
import play.api.libs.json.*
import reactivemongo.api.AsyncDriver

import lila.db.dsl.*
import lila.xiangqi.{ Xiangqi, XiangqiRules }

class GameAnalysisImportTest extends munit.FunSuite:
  given Executor = scala.concurrent.ExecutionContext.global
  private val game =
    XiangqiRules.game(Xiangqi.Position(moves = Vector("a4a5", "a7a6").map(Xiangqi.Uci.unsafe))).toOption.get
  private val id = Analysis.Id(GameId("native01"))
  private def positions(depth: Int) = List(
    Json.obj("cp" -> 20, "depth" -> depth, "pv" -> List("b1c3")),
    Json.obj("cp" -> 35, "depth" -> (depth + 2), "pv" -> List("a7a6")),
    Json.obj("cp" -> 10, "depth" -> depth, "pv" -> List("c4c5"))
  )
  private def analysis(depth: Int) = GameAnalysisImport.build(id, game, positions(depth))

  test("offline publication uses achieved minimum depth and native Red-perspective scores"):
    val result = analysis(20)
    assertEquals(result.depth, Some(20))
    assertEquals(result.infos.map(_.cp), List(Some(Cp(-35)), Some(Cp(10))))
    assertEquals(result.infos.head.best, Some("b1c3"))
    assertEquals(
      result.infos.head.variation.map(_.value),
      List("b1c3")
    )

  test("incomplete games, missing nonterminal scores, and illegal best moves are rejected"):
    intercept[IllegalArgumentException](GameAnalysisImport.build(id, game, positions(20).take(2)))
    intercept[IllegalArgumentException](GameAnalysisImport.build(id, game, JsNull :: positions(20).tail))
    intercept[IllegalArgumentException](
      GameAnalysisImport.build(
        id,
        game,
        positions(20).updated(0, Json.obj("cp" -> 10, "depth" -> 20, "pv" -> List("a1a10")))
      )
    )

  test("Black-to-move starting positions preserve ply offsets and score perspective"):
    val fen = game.states(1).fen.split(' ').updated(5, "17").mkString(" ")
    val blackStart = XiangqiRules.game(Xiangqi.Position(fen, Vector(Xiangqi.Uci.unsafe("a7a6")))).toOption.get
    val result = GameAnalysisImport.build(id, blackStart, positions(20).tail)
    assertEquals(result.startPly, Ply(33))
    assertEquals(result.infos.head.ply, Ply(34))
    assertEquals(result.infos.head.cp, Some(Cp(10)))

  test("a terminal final position still records the final move"):
    val mate = XiangqiRules
      .game(
        Xiangqi.Position(
          "4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1",
          Vector(Xiangqi.Uci.unsafe("a3e3"))
        )
      )
      .toOption
      .get
    val result = GameAnalysisImport.build(
      id,
      mate,
      List(
        Json.obj("mate" -> 1, "depth" -> 20, "pv" -> List("a3e3")),
        JsNull
      )
    )
    assertEquals(result.infos.size, 1)
    assertEquals(result.infos.head.mate.map(_.value), Some(0))
    assertEquals(result.depth, Some(20))

  test("catalog identities and depths survive the canonical BSON codec; legacy depth stays unknown"):
    import AnalyseBsonHandlers.given
    val value =
      analysis(30).copy(id = Analysis.Id.Catalog("source:123"), date = java.time.Instant.ofEpochMilli(1))
    val bson = toBdoc(value).get
    assertEquals(bson.asTry[Analysis].get, value)
    assertEquals((bson -- "depth").asTry[Analysis].get.depth, None)

  if sys.env.contains("LIXIANGQI_ANALYSIS_TEST_URI") then
    test("Mongo publication retains the deepest result across retries and concurrent Fishnet writes"):
      import scala.concurrent.Await
      val driver = new AsyncDriver()
      def waitFor[A](future: Fu[A]): A = Await.result(future, 30.seconds)
      val connection = waitFor(driver.connect(sys.env("LIXIANGQI_ANALYSIS_TEST_URI")))
      val database = waitFor(
        connection.database(
          "analysis_publication_test_" + java.util.UUID.randomUUID().toString.replace("-", "")
        )
      )
      val repo = AnalysisRepo(database.collection[Coll]("analysis"))
      try
        waitFor(repo.save(analysis(20), None))
        val original = waitFor(repo.current(id)).get
        waitFor(repo.save(analysis(15), None))
        waitFor(repo.save(analysis(20).copy(infos = analysis(20).infos.map(_.invert)), None))
        assertEquals(waitFor(repo.current(id)), Some(original))
        waitFor(Future.sequence(List(30, 15, 25, 20, 40, 35).map(depth => repo.save(analysis(depth), None))))
        assertEquals(waitFor(repo.current(id)).flatMap(_.depth), Some(40))
        waitFor(repo.save(analysis(30).copy(depth = None), None))
        assertEquals(waitFor(repo.current(id)).flatMap(_.depth), Some(40))
        assertEquals(waitFor(repo.depths(List(id))), Map("native01" -> Some(40)))
        (1 to 10).foreach: index =>
          val raceId = Analysis.Id.Catalog(s"race-$index")
          waitFor(
            Future.sequence(List(20, 40, 30).map(depth => repo.save(analysis(depth).copy(id = raceId), None)))
          )
          assertEquals(waitFor(repo.current(raceId)).flatMap(_.depth), Some(40))
        val legacy = analysis(20).copy(id = Analysis.Id(GameId("legacy01")), depth = None)
        waitFor(repo.save(legacy, None))
        waitFor(repo.save(legacy.copy(depth = Some(30)), None))
        assertEquals(waitFor(repo.current(legacy.id)).flatMap(_.depth), Some(30))

        val chapterId = StudyChapterId("native01")
        val studyId = Analysis.Id.Study(StudyId("study001"), chapterId)
        val firstSource = analysis(40).copy(id = studyId, date = java.time.Instant.ofEpochSecond(10))
        val revisedSource = firstSource.copy(
          position = game.position.copy(moves = game.moves.take(1)),
          infos = firstSource.infos.take(1),
          depth = Some(20),
          date = java.time.Instant.ofEpochSecond(20)
        )
        waitFor(repo.save(firstSource, None))
        waitFor(repo.save(revisedSource, None))
        waitFor(repo.save(firstSource.copy(depth = Some(60)), None))
        assertEquals(waitFor(repo.current(studyId)), Some(revisedSource))
        waitFor(repo.removeChapters(List(chapterId)))
        assertEquals(waitFor(repo.current(studyId)), None)
        assertEquals(waitFor(repo.current(id)).flatMap(_.depth), Some(40))

        val games = new lila.game.GameRepo(database.collection[Coll]("games"))
        val native = lila.core.game
          .newGame(
            game,
            ByColor(lila.core.game.Player(lila.core.id.GamePlayerId("abcd"), _, aiLevel = None)),
            rated = chess.Rated.No,
            source = lila.core.game.Source.Api,
            pgnImport = None
          )
          .withId(GameId("native01"))
        waitFor(games.insertDenormalized(native))
        val sink = new Analyser(games, repo)
        waitFor(sink.save(analysis(15), Array.emptyByteArray))
        assert(waitFor(games.game(native.id)).get.metadata.analysed)
        assertEquals(waitFor(repo.current(id)).flatMap(_.depth), Some(40))
      finally
        waitFor(database.drop())
        waitFor(driver.close())
