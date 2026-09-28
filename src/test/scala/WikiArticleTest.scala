import play.api.libs.json.*

import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.adjudication.Ruleset
import lila.xiangqi.XiangqiJson.given

class WikiArticleTest extends munit.FunSuite:
  test("every article example replays legally with native notation and a valid starting frame"):
    val stream = getClass.getResourceAsStream("/wiki/elbow-horse.json")
    assert(stream != null)
    val records = scala.util.Using.resource(scala.io.Source.fromInputStream(stream, "UTF-8")): source =>
      Json.parse(source.mkString).as[Vector[JsObject]]
    assertEquals(records.size, 6)
    var total = 0
    records.foreach: record =>
      val id = (record \ "id").as[String]
      val moves = (record \ "moves").as[Vector[Xiangqi.Uci]]
      val game = XiangqiRules
        .game(
          Xiangqi.Position((record \ "initialFen").as[String], moves, Ruleset.Unrestricted)
        )
        .fold(error => fail(s"$id: $error"), identity)
      assertEquals(game.states.size, moves.size + 1, id)
      assertEquals(game.wxf.size, moves.size, id)
      assertEquals(game.chineseWxf.size, moves.size, id)
      assert((record \ "initialPly").as[Int] <= moves.size, id)
      (record \ "annotations")
        .as[JsObject]
        .keys
        .foreach: key =>
          assert(key.toInt >= 0 && key.toInt <= moves.size, s"$id annotation $key")
      if id == "final2019" then assertEquals(game.wxf(27), "c8-5")
      total += moves.size
    assertEquals(total, 232)
