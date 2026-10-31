package controllers

import chess.ByColor
import play.api.libs.json.{ Json, JsObject, JsError, JsValue, Reads, Writes }
import play.api.mvc.*

import lila.app.{ *, given }
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
      case Array("minixiangqi") => load(Some(lila.xiangqi.MiniXiangqiRules.startFen))
      case Array("minixiangqi", fen) => load(fen.some)
      case Array("jieqi") => load(Some(lila.xiangqi.Jieqi.startFen))
      case Array("jieqi", fen) => load(fen.some)
      case Array("threeKingdoms") =>
        Open:
          Ok.page(views.xiangqi.analysis(Json.obj("variant" -> "threeKingdoms")))
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
      XiangqiRules
        .game(
          Xiangqi.Position(
            command.initialFen,
            command.moves,
            command.ruleset,
            command.reveals,
            command.knownCaptures
          )
        )
        .flatMap: game =>
          if game.isJieqi then lila.xiangqi.Jieqi.analysisMove(game, command.move, command.reveal)
          else XiangqiRules.move(game, command.move)

  def variation = AnonBodyOf(parse.json): body =>
    nativeJson[Xiangqi.VariationCommand, Xiangqi.VariationResult](body)(XiangqiRules.variation)

  def moveLabels = AnonBodyOf(parse.json(4096)): body =>
    nativeJson[Xiangqi.MoveLabelsCommand, Map[String, Xiangqi.MoveLabels]](body)(XiangqiRules.moveLabels)

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
      case Right(game) =>
        Ok.page(
          views.xiangqi.analysis:
            Json
              .obj("variant" -> game.variant.key, "ruleset" -> game.ruleset)
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
        UserAnalysis
          .bootstrap(
            pov,
            analysis,
            analysisInProgress,
            ownedPovForReq(pov.game)
              .map(p => if p.color.white then Xiangqi.Side.Red else Xiangqi.Side.Black)
          )(using env.user.lightUserApi.async, env.executor)
          .flatMap: data =>
            Ok.page(
              views.xiangqi.analysis(data ++ Json.obj("explorerEndpoint" -> env.fishnet.explorerEndpoint))
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
      analysisInProgress: Boolean = false,
      viewer: Option[Xiangqi.Side] = None
  )(using lila.core.LightUser.Getter, Executor): Fu[JsObject] =
    pov.game.players
      .traverse(player =>
        player.userId
          .so(summon[lila.core.LightUser.Getter])
          .map(lila.game.Namer.recordedPlayerText(player, _))
      )
      .map: names =>
        bootstrapData(pov, names, analysis, analysisInProgress, viewer)

  private[controllers] def bootstrapData(
      pov: Pov,
      names: ByColor[String],
      analysis: Option[lila.tree.Analysis],
      analysisInProgress: Boolean,
      viewer: Option[Xiangqi.Side]
  ): JsObject =
    import lila.xiangqi.XiangqiJson.given
    Json
      .obj(
        "gameId" -> pov.gameId,
        "title" -> s"${names.white} – ${names.black}",
        "headers" -> Json.obj(
          "red" -> names.white,
          "black" -> names.black,
          "result" -> lila.game.PgnDump.result(pov.game),
          "gameid" -> pov.gameId
        ),
        "initialFen" -> pov.game.xiangqi.initialFen,
        "moves" -> pov.game.xiangqi.moves,
        "notations" -> pov.game.xiangqi.wxf,
        "chineseNotations" -> pov.game.xiangqi.chineseWxf,
        "states" -> lila.xiangqi.Jieqi.publicStates(pov.game.xiangqi, viewer),
        "variant" -> pov.game.nativeVariant.key,
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
