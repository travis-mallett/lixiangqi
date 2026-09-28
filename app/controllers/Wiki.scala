package controllers

import play.api.libs.json.*

import lila.app.*
import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.adjudication.Ruleset
import lila.xiangqi.XiangqiJson.given

final class Wiki(env: Env) extends LilaController(env):

  private def resource(name: String): String =
    val stream = Option(getClass.getResourceAsStream(s"/wiki/$name"))
      .getOrElse(throw IllegalStateException(s"Missing wiki resource: $name"))
    scala.util.Using.resource(scala.io.Source.fromInputStream(stream, "UTF-8"))(_.mkString)

  private lazy val article = resource("elbow-horse.html")

  // These fixed examples are validated and replayed once, not once per reader or click.
  private lazy val examples = Json
    .parse(resource("elbow-horse.json"))
    .as[Vector[JsObject]]
    .map: record =>
      val id = (record \ "id").as[String]
      val position = Xiangqi.Position(
        initialFen = (record \ "initialFen").as[String],
        moves = (record \ "moves").as[Vector[Xiangqi.Uci]],
        ruleset = Ruleset.Unrestricted
      )
      val game = XiangqiRules
        .game(position)
        .fold(
          error => throw IllegalStateException(s"Invalid wiki example $id: $error"),
          identity
        )
      Json.obj(
        "id" -> id,
        "initialPly" -> (record \ "initialPly").as[Int],
        "annotations" -> (record \ "annotations").as[JsObject],
        "replay" -> Json.obj(
          "ruleset" -> game.ruleset.key,
          "states" -> game.states,
          "script" -> game.moves.zip(game.wxf).zip(game.chineseWxf).map { case ((move, english), chinese) =>
            Json.obj("move" -> move, "english" -> english, "chinese" -> chinese)
          }
        )
      )

  def elbowHorse = Open:
    InEmbedContext:
      fuccess(Ok.snip(views.wiki.elbowHorse(article, examples)))
