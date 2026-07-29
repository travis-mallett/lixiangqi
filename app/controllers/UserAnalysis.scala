package controllers

import chess.format.Fen
import chess.variant.{ Standard, Variant }
import chess.{ ByColor, Position }
import play.api.libs.json.{ Json, JsObject, JsError, JsValue, Reads, Writes }
import play.api.mvc.*

import lila.app.*
import lila.common.Json.given
import lila.core.id.GameFullId
import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.XiangqiJson.given

final class UserAnalysis(env: Env) extends LilaController(env) with lila.web.TheftPrevention:

  def index = load(none, Standard)

  def parseArg(arg: String) =
    arg.split("/", 2) match
      case Array(key) if key == Standard.key.value => load(none, Standard)
      case Array(key, fen) if key == Standard.key.value => load(fen.some, Standard)
      case _ => load(arg.some, Standard)

  def embed = load(none, Standard)

  def position = AnonBodyOf(parse.json): body =>
    nativeJson[Xiangqi.Position, Xiangqi.State](body)(XiangqiRules.position)

  def move = AnonBodyOf(parse.json): body =>
    nativeJson[Xiangqi.MoveCommand, Xiangqi.MoveResult](body): command =>
      XiangqiRules.move(Xiangqi.Position(command.initialFen, command.moves), command.move)

  def importNotation = AnonBodyOf(parse.json): body =>
    nativeJson[Xiangqi.NotationImport, Xiangqi.ImportedMoveTree](body): command =>
      XiangqiRules.Notation.importTree(command)

  private def nativeJson[A: Reads, B: Writes](body: JsValue)(run: A => Either[String, B]) =
    body
      .validate[A]
      .fold(
        errors => fuccess(BadRequest(jsonError(JsError.toJson(errors).toString))),
        command =>
          fuccess:
            run(command).fold(
              error => BadRequest(jsonError(error)),
              result => JsonOk(Json.toJson(result))
            )
      )

  private def load(pathFen: Option[String], variant: Variant) = Open:
    val fen = pathFen.orElse(get("fen").map(_.trim).filter(_.nonEmpty))
    val orientation = get("color").filter(color => color == "white" || color == "black")
    Ok.page(
      views.xiangqi.analysis:
        Json
          .obj("variant" -> variant.key.value)
          .add("initialFen", fen)
          .add("orientation", orientation)
          ++ Json.obj("explorerEndpoint" -> env.fishnet.explorerEndpoint)
    )

  def game(gameId: GameId, color: Color) = Open:
    Found(env.game.gameRepo.pov(gameId, color)): pov =>
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

  private[controllers] def makePov(fen: Option[Fen.Full], variant: Variant): Pov =
    makePov:
      Position.AndFullMoveNumber(variant, fen.filter(_.value.nonEmpty))

  private def makePov(from: Position.AndFullMoveNumber): Pov =
    Pov(
      lila.core.game
        .newGame(
          xiangqi = Xiangqi.Game.initial,
          players = ByColor(lila.game.Player.make(_, none)),
          rated = chess.Rated.No,
          source = lila.core.game.Source.Api,
          pgnImport = None,
          variant = from.position.variant
        )
        .withId(lila.game.Game.syntheticId),
      from.position.color
    )

  private def forecastReload = JsonOk(Json.obj("reload" -> true))

  def forecastsPost(fullId: GameFullId) = AuthOrScopedBodyWithParser(parse.json)(_.Web.Mobile) { ctx ?=> _ ?=>
    import lila.round.Forecast
    Found(env.round.proxyRepo.pov(fullId)): pov =>
      if isTheft(pov) then theftResponse
      else
        ctx.body.body
          .validate[Forecast.Steps]
          .fold(
            err => BadRequest(err.toString),
            forecasts =>
              val fu = for
                _ <- env.round.forecastApi.save(pov, forecasts)
                res <- env.round.forecastApi.loadForDisplay(pov)
              yield res.fold(JsonOk(Json.obj("none" -> true)))(JsonOk(_))
              fu.recover:
                case Forecast.OutOfSync => forecastReload
                case _: lila.core.round.ClientError => forecastReload
          )
  }

  def forecastsGet(fullId: GameFullId) = Scoped(_.Web.Mobile) { _ ?=> _ ?=>
    Found(env.round.proxyRepo.pov(fullId)): pov =>
      JsonOk(env.round.mobile.forecast(pov.game, pov.fullId.anyId))
  }

  def forecastsOnMyTurn(fullId: GameFullId, uci: String) =
    AuthOrScopedBodyWithParser(parse.json)(_.Web.Mobile) { ctx ?=> _ ?=>
      import lila.round.Forecast
      Found(env.round.proxyRepo.pov(fullId)): pov =>
        if isTheft(pov) then theftResponse
        else
          ctx.body.body
            .validate[Forecast.Steps]
            .fold(
              err => BadRequest(err.toString),
              forecasts =>
                for
                  _ <- env.round.forecastApi
                    .playAndSave(pov, uci, forecasts)
                    .recover:
                      case _: Exception => ()
                  wait = (1 + Forecast.maxPlies(forecasts).min(10)) * 50
                  _ <- lila.common.LilaFuture.sleep(wait.millis)
                yield forecastReload
            )
    }

object UserAnalysis:

  def bootstrap(
      pov: Pov,
      analysis: Option[lila.tree.Analysis] = none,
      analysisInProgress: Boolean = false
  ): JsObject =
    import lila.xiangqi.XiangqiJson.given
    Json.obj(
      "gameId" -> pov.gameId,
      "title" -> s"${pov.game.whitePlayer.name} – ${pov.game.blackPlayer.name}",
      "initialFen" -> pov.game.xiangqi.initialFen,
      "moves" -> pov.game.xiangqi.moves,
      "notations" -> pov.game.xiangqi.wxf,
      "chineseNotations" -> pov.game.xiangqi.chineseWxf,
      "states" -> pov.game.xiangqi.states,
      "variant" -> pov.game.variant.key.value,
      "orientation" -> pov.color.name,
      "analysisInProgress" -> analysisInProgress,
      "analysisRequestUrl" ->
        (analysis.isEmpty && lila.game.GameExt.analysable(pov.game))
          .option(routes.Analyse.requestAnalysis(pov.gameId).url),
      "analysis" -> analysis.map: value =>
        Json.obj(
          "id" -> value.id.value,
          "infos" -> value.infos.map: info =>
            Json
              .obj(
                "ply" -> info.ply.value,
                "variation" -> info.variation.map(_.toString)
              )
              .add("cp", info.cp.map(_.value))
              .add("mate", info.mate.map(_.value))
              .add("best", info.best)
        )
    )
