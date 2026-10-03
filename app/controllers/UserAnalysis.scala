package controllers

import chess.ByColor
import play.api.libs.json.{ Json, JsObject, JsError, JsValue, Reads, Writes }
import play.api.mvc.*

import lila.app.*
import lila.common.Json.given
import lila.core.id.GameFullId
import lila.xiangqi.{ Xiangqi, XiangqiRules, XiangqiNotation }
import lila.xiangqi.XiangqiJson.given

final class UserAnalysis(env: Env) extends LilaController(env) with lila.web.TheftPrevention:

  def index = load(none)

  def parseArg(arg: String) =
    arg.split("/", 2) match
      case Array("xiangqi") => load(none)
      case Array("xiangqi", fen) => load(fen.some)
      case _ => load(arg.some)

  def embed = Anon:
    given EmbedContext = EmbedContext(summon[Context], defaultUiTheme = lila.pref.UiThemes.light.key)
    Ok.snip(views.boardViewer(Json.obj("initialFen" -> get("fen"), "orientation" -> get("color"))))

  def catalogAnalysis(id: String) = Open:
    if !lila.analyse.GameAnalysisImport.validCatalogId(id) then BadRequest(jsonError("Invalid catalog ID"))
    else
      env.analyse.repo
        .byId(lila.tree.Analysis.Id.Catalog(id))
        .map: analysis =>
          Ok(Json.obj("analysis" -> analysis.map(lila.analyse.XiangqiAnalysis.json))).noCache

  def position = AnonBodyOf(parse.json): body =>
    nativeJson[Xiangqi.Position, Xiangqi.State](body)(XiangqiRules.position)

  def move = AnonBodyOf(parse.json): body =>
    nativeJson[Xiangqi.MoveCommand, Xiangqi.MoveResult](body): command =>
      XiangqiRules.move(Xiangqi.Position(command.initialFen, command.moves, command.ruleset), command.move)

  def variation = AnonBodyOf(parse.json): body =>
    nativeJson[Xiangqi.VariationCommand, Xiangqi.VariationResult](body)(XiangqiRules.variation)

  def notationMove = AnonBodyOf(parse.json): body =>
    nativeJson[Xiangqi.NotationMoveCommand, Xiangqi.MoveResult](body): input =>
      for
        _ <- Either.cond(input.notation.length <= 32, (), "Move notation is too long")
        game <- lila.xiangqi.XiangqiEvaluation.game(
          Xiangqi.Position(input.initialFen, input.moves, input.ruleset)
        )
        move <- XiangqiRules.resolveNotation(game, input.notation)
        result <- XiangqiRules.move(game, move)
      yield result

  private val motifsCache = env.memo.cacheApi
    .notLoadingSync[Xiangqi.Position, Either[String, lila.xiangqi.XiangqiMotifs.Motifs]](
      256,
      "xiangqi.motifs"
    ):
      _.maximumSize(256).expireAfterWrite(5.minutes).build()

  def motifs = AnonBodyOf(parse.json): body =>
    nativeJson[Xiangqi.Position, lila.xiangqi.XiangqiMotifs.Motifs](body): position =>
      motifsCache.get(position, lila.xiangqi.XiangqiMotifs.apply)

  def book = AnonBodyOf(parse.json(100_000)): body =>
    body
      .validate[lila.analyse.XiangqiBook.Request]
      .fold(
        errors => fuccess(BadRequest(jsonError(JsError.toJson(errors).toString))),
        request =>
          env.analyse
            .xiangqiBook(request)
            .map(
              _.fold(
                error => BadRequest(jsonError(error)),
                result => JsonOk(Json.toJson(result))
              )
            )
      )

  // Repeated short wiki examples share parsed positions. Long user imports remain uncached.
  private val notationCache = env.memo.cacheApi
    .notLoadingSync[Xiangqi.NotationImport, Either[String, Xiangqi.ImportedMoveTree]](64, "xiangqi.notation"):
      _.maximumSize(64).expireAfterWrite(10.minutes).build()

  def importNotation = AnonBodyOf(parse.json): body =>
    nativeJson[Xiangqi.NotationImport, Xiangqi.ImportedMoveTree](body): command =>
      if command.notation.length <= 4000 then notationCache.get(command, XiangqiNotation.importTree)
      else XiangqiNotation.importTree(command)

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

  private def load(pathFen: Option[String]) = Open:
    val fen = pathFen.orElse(get("fen").map(_.trim).filter(_.nonEmpty))
    val orientation = get("color").flatMap(Xiangqi.Side.fromKey(_).toOption)
    XiangqiRules.game(Xiangqi.Position(initialFen = fen.getOrElse(Xiangqi.startFen))) match
      case Left(error) => BadRequest(jsonError(error))
      case Right(_) =>
        Ok.page(
          views.xiangqi.analysis:
            Json
              .obj("variant" -> "xiangqi", "ruleset" -> lila.xiangqi.adjudication.Ruleset.Unrestricted)
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

  private[controllers] def makePov(game: Xiangqi.Game): Pov =
    Pov(
      lila.core.game
        .newGame(
          xiangqi = game,
          players = ByColor(lila.game.Player.make(_, none)),
          rated = chess.Rated.No,
          source = lila.core.game.Source.Api,
          pgnImport = None
        )
        .withId(lila.game.Game.syntheticId),
      if game.state.turn.red then Color.White else Color.Black
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
    Json
      .obj(
        "gameId" -> pov.gameId,
        "title" -> s"${pov.game.whitePlayer.name} – ${pov.game.blackPlayer.name}",
        "initialFen" -> pov.game.xiangqi.initialFen,
        "moves" -> pov.game.xiangqi.moves,
        "notations" -> pov.game.xiangqi.wxf,
        "chineseNotations" -> pov.game.xiangqi.chineseWxf,
        "states" -> pov.game.xiangqi.states,
        "variant" -> "xiangqi",
        "ruleset" -> pov.game.xiangqi.ruleset,
        "orientation" -> (if pov.color.white then Xiangqi.Side.Red else Xiangqi.Side.Black),
        "analysisInProgress" -> analysisInProgress,
        "analysisRequestUrl" ->
          (analysis.isEmpty && lila.game.GameExt.analysable(pov.game))
            .option(routes.Analyse.requestAnalysis(pov.gameId).url),
        "analysis" -> analysis.map(lila.analyse.XiangqiAnalysis.json)
      )
      .add(
        "recordedClock" ->
          (if pov.game.finished then lila.game.RecordedClockTimeline(pov.game) else None).map(_.json)
      )
