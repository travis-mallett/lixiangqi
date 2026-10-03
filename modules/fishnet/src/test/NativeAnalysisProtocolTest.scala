package lila.fishnet

import play.api.libs.json.*
import lila.xiangqi.Xiangqi
import lila.xiangqi.adjudication.Ruleset

class NativeAnalysisProtocolTest extends munit.FunSuite:
  import JsonApi.readers.given
  import JsonApi.writers.given

  test("work carries native literal moves and full-history legal positions"):
    val native = Work.Game("chapter1", None, Some(StudyId("study001")), Ruleset.Unrestricted, "i1i2 i10i9")
    val json = Json.toJson(JsonApi.fromGame(native))
    assertEquals((json \ "moves").as[String], "i1i2 i10i9")
    assertEquals((json \ "ruleset").as[String], Ruleset.Unrestricted.key)
    assertEquals((json \ "positions").as[JsArray].value.size, 3)
    assertEquals((json \ "positions")(1).as[JsObject].value("turn"), JsString("black"))
    assert(!(json \ "variant").isDefined)
    assert((json \ "positions")(1).as[JsObject].value("legalMoves").as[List[String]].contains("i10i9"))

  test("Pikafish metadata, terminal depth zero, and partial holes retain their indices"):
    val metadata = Json.obj("name" -> "Pikafish", "version" -> "native", "nnue" -> true)
    val terminal = Json.obj("score" -> Json.obj("mate" -> 0), "pv" -> "", "depth" -> 0)
    val complete =
      Json.obj("engine" -> metadata, "analysis" -> Json.arr(terminal)).as[JsonApi.Request.PostAnalysis]
    assert(complete.completeOrPartial.isInstanceOf[JsonApi.Request.CompleteAnalysis])
    val partial = Json
      .obj("engine" -> metadata, "analysis" -> Json.arr(JsNull, terminal))
      .as[JsonApi.Request.PostAnalysis]
    assert(partial.completeOrPartial.isInstanceOf[JsonApi.Request.PartialAnalysis])
    assertEquals(partial.analysis.size, 2)
    assert(partial.analysis.head.isEmpty)
    assert(
      Json
        .obj("engine" -> metadata, "analysis" -> Json.arr(terminal ++ Json.obj("pv" -> "i:i9")))
        .validate[JsonApi.Request.PostAnalysis]
        .isError
    )
