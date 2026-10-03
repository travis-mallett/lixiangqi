package controllers

import play.api.libs.json.{ JsArray, JsError, JsValue, Json, Reads }
import org.apache.pekko.util.ByteString
import play.api.mvc.*

import lila.app.*
import lila.common.HTTPRequest
import lila.oauth.AccessToken

final class Analyse(env: Env) extends LilaController(env):

  def requestAnalysis(id: GameId) = AuthOrScoped(_.Web.Mobile) { ctx ?=> me ?=>
    Found(env.game.gameRepo.game(id)): game =>
      env.fishnet
        .analyser(
          game,
          lila.fishnet.Work.Sender(
            userId = me,
            ip = ctx.ip.some,
            mod = isGranted(_.UserEvaluate) || isGranted(_.Relay),
            system = false
          )
        )
        .map:
          _.error.fold(NoContent)(BadRequest(_))
  }

  private[controllers] def replay(
      pov: Pov,
      @annotation.unused userTv: Option[lila.user.User]
  )(using @annotation.unused ctx: Context) =
    (
      env.analyse.repo.byGame(pov.game),
      if pov.game.metadata.analysed then fuccess(false)
      else env.fishnet.api.userAnalysisExists(pov.gameId)
    ).flatMapN: (analysis, analysisInProgress) =>
      Ok.page(
        views.xiangqi.analysis:
          UserAnalysis.bootstrap(
            pov,
            analysis,
            analysisInProgress
          ) ++ Json.obj("explorerEndpoint" -> env.fishnet.explorerEndpoint)
      ).dmap(_.noCache)

  def embed(gameId: GameId, color: Color) = embedReplayGame(gameId, color)

  def embedReplayGame(gameId: GameId, color: Color) = Anon:
    Found(env.game.gameRepo.pov(gameId, color)): pov =>
      given EmbedContext = EmbedContext(summon[Context], defaultUiTheme = lila.pref.UiThemes.light.key)
      Ok.snip(views.boardViewer(UserAnalysis.bootstrap(pov)))

  def externalEngineList = ScopedBody(_.Engine.Read) { _ ?=> me ?=>
    env.analyse.externalEngine.list(me).map { list =>
      JsonOk(JsArray(list.map(lila.analyse.ExternalEngine.jsonWrites.writes)))
    }
  }

  def externalEngineShow(id: String) = ScopedBody(_.Engine.Read) { _ ?=> me ?=>
    Found(env.analyse.externalEngine.find(me, id)): engine =>
      JsonOk(lila.analyse.ExternalEngine.jsonWrites.writes(engine))
  }

  def externalEngineCreate = ScopedBody(_.Engine.Write) { ctx ?=> me ?=>
    HTTPRequest.bearer(ctx.req).so { bearer =>
      val tokenId = AccessToken.idFrom(bearer)
      bindForm(lila.analyse.ExternalEngine.form)(
        jsonFormError,
        data =>
          env.analyse.externalEngine.create(me, data, tokenId).map { engine =>
            Created(lila.analyse.ExternalEngine.jsonWrites.writes(engine))
          }
      )
    }
  }

  def externalEngineUpdate(id: String) = ScopedBody(_.Engine.Write) { ctx ?=> me ?=>
    Found(env.analyse.externalEngine.find(me, id)): engine =>
      bindForm(lila.analyse.ExternalEngine.form)(
        jsonFormError,
        data =>
          env.analyse.externalEngine.update(engine, data).map { engine =>
            JsonOk(lila.analyse.ExternalEngine.jsonWrites.writes(engine))
          }
      )
  }

  def externalEngineDelete(id: String) = AuthOrScoped(_.Engine.Write) { _ ?=> me ?=>
    env.analyse.externalEngine.delete(me, id).elseNotFound(jsonOkResult)
  }

  def externalEngineAnalyse(id: String) = AnonBodyOf(parse.json(100_000)): body =>
    externalInput[lila.analyse.ExternalEngineBroker.Request](body): input =>
      env.analyse.externalEngineBroker
        .analyse(id, input)
        .map:
          case Left(error) => Status(error.status)(jsonError(error.message))
          case Right(source) =>
            Ok.chunked(source.map(json => ByteString(Json.stringify(json) + "\n")))
              .as("application/x-ndjson")
              .withHeaders("Cache-Control" -> "no-store", "X-Accel-Buffering" -> "no")

  def externalEngineAcquire = AnonBodyOf(parse.json(4096)): body =>
    (body \ "providerSecret")
      .validate[String]
      .fold(
        _ => fuccess(BadRequest(jsonError("Missing provider credentials"))),
        secret =>
          fuccess(
            env.analyse.externalEngineBroker
              .acquire(secret)
              .fold(
                error => Status(error.status)(jsonError(error.message)),
                _.fold(NoContent)(JsonOk(_))
              )
          )
      )

  def externalEngineSubmit(id: String) = AnonBodyOf(parse.json(100_000)): body =>
    externalInput[lila.analyse.ExternalEngineBroker.Update](body): update =>
      fuccess(
        env.analyse.externalEngineBroker
          .submit(id, update)
          .fold(
            error => Status(error.status)(jsonError(error.message)),
            _ => NoContent
          )
      )

  private def externalInput[A: Reads](body: JsValue)(run: A => Fu[Result]): Fu[Result] =
    body
      .validate[A]
      .fold(
        errors => fuccess(BadRequest(jsonError(JsError.toJson(errors).toString))),
        run
      )
