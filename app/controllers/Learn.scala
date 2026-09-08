package controllers

import play.api.libs.json.*

import lila.app.*
import lila.core.rank.RankCode
import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.XiangqiJson.given

final class Learn(env: Env) extends LilaController(env):

  import lila.learn.LearnHandlers.given
  import RankCode.*

  def index = Open(serveIndex)
  def indexLang = LangPage(routes.Learn.index)(serveIndex)
  def specialRules = Open:
    Ok.page(views.learn.specialRulesPage)

  def specialRulesExample(id: String, ply: Int) = Open:
    import lila.xiangqi.SpecialRulesExamples
    val response = for
      example <- SpecialRulesExamples.get(id).toRight("Unknown special rules example")
      playback <- example.at(ply)
      labels <- example.labels
    yield Json.obj(
      "ruleset" -> example.ruleset.key,
      "state" -> playback.game.state,
      "acceptedPly" -> playback.game.moves.size,
      "lastMove" -> playback.game.moves.lastOption,
      "rejected" -> playback.rejected
        .map(a => Json.obj("ply" -> a.ply, "move" -> a.move, "error" -> a.error)),
      "script" -> labels.map { (move, english, chinese) =>
        Json.obj("move" -> move, "english" -> english, "chinese" -> chinese)
      }
    )
    fuccess(
      response.fold(
        error => BadRequest(Json.obj("error" -> error)),
        json => Ok(json).withHeaders("Cache-Control" -> "no-store")
      )
    )

  def ancientManuals = Open:
    Ok.page(views.learn.ancientManualsPage)
  def xiangqiRankings = Open:
    val levels = lila.rating.XiangqiRank.catalog.levels.map: level =>
      level.code.value -> level.threshold.value
    Ok.page(views.learn.xiangqiRankingsPage(levels))

  def validate = AnonBodyOf(parse.json): body =>
    body
      .validate[Xiangqi.Position]
      .fold(
        errors => fuccess(BadRequest(jsonError(JsError.toJson(errors).toString))),
        command =>
          fuccess:
            XiangqiRules.Lesson
              .validate(command)
              .fold(error => BadRequest(jsonError(error)), result => JsonOk(Json.toJson(result)))
      )

  private def serveIndex(using ctx: Context) = NoBot:
    pageHit
    ctx.me
      .traverse: me =>
        env.learn.api.get(me).map(Json.toJson)
      .flatMap: progress =>
        Ok.page(views.learn(progress))

  def score = AuthBody { ctx ?=> me ?=>
    bindForm(lila.learn.StageProgress.form)(
      jsonFormError,
      (stage, level, s) =>
        val score = lila.learn.StageProgress.Score(s)
        for
          _ <- env.learn.api.setScore(me, stage, level, score)
          _ <- env.activity.write.learn(me, stage)
        yield jsonOkResult
    )
  }

  def reset = AuthBody { _ ?=> me ?=>
    for _ <- env.learn.api.reset(me)
    yield jsonOkResult
  }
