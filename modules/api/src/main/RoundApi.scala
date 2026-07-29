package lila.api

import chess.format.Fen
import play.api.libs.json.*

import lila.analyse.{ Analysis, JsonView as analysisJson }
import lila.api.Context.given
import lila.common.HTTPRequest
import lila.common.Json.given
import scalalib.data.Preload
import lila.core.i18n.Translate
import lila.core.perm.Granter
import lila.core.user.GameUsers
import lila.pref.Pref
import lila.round.{ Forecast, JsonView }
import lila.simul.Simul
import lila.swiss.GameView as SwissView
import lila.tournament.GameView as TourView
import lila.tree.ExportOptions
import lila.xiangqi.Xiangqi.NotationStyle
import lila.game.GameExt.timeForFirstMove
import lila.mon.extensions.*

final private[api] class RoundApi(
    jsonView: JsonView,
    noteApi: lila.round.NoteApi,
    forecastApi: lila.round.ForecastApi,
    bookmarkApi: lila.bookmark.BookmarkApi,
    gameRepo: lila.game.GameRepo,
    tourApi: lila.tournament.TournamentApi,
    swissApi: lila.swiss.SwissApi,
    simulApi: lila.simul.SimulApi,
    externalEngineApi: lila.analyse.ExternalEngineApi,
    getLightTeam: lila.core.team.LightTeam.GetterSync,
    userApi: lila.user.UserApi,
    prefApi: lila.pref.PrefApi,
    getLightUser: lila.core.LightUser.GetterSync,
    userLag: lila.socket.UserLagCache,
    divider: lila.game.Divider
)(using Executor):

  def player(
      pov: Pov,
      users: Preload[GameUsers],
      tour: Option[TourView]
  )(using ctx: Context): Fu[JsObject] = {
    for
      initialFen <- gameRepo.initialFen(pov.game)
      users <- users.orLoad(userApi.gamePlayers(pov.game.userIdPair, pov.game.perfKey))
      prefs <- prefApi.get(users.map(_.map(_.user)), pov.color, ctx.pref)
      (json, simul, swiss, note, forecast, bookmarked) <-
        (
          jsonView.playerJson(
            pov,
            prefs,
            users,
            initialFen,
            ctx.pref.xiangqiNotationStyle(ctx.lang),
            ctxFlags
          ),
          pov.game.simulId.so(simulApi.find),
          swissApi.gameView(pov),
          ctx.myId.ifTrue(ctx.isMobileApi).so(noteApi.get(pov.gameId, _)),
          forecastApi.loadForDisplay(pov),
          bookmarkApi.exists(pov.game, ctx.me)
        ).tupled
    yield (
      withTournament(pov, tour)
        .compose(withSwiss(swiss))
        .compose(withSimul(simul))
        .compose(withSteps(pov))
        .compose(withNote(note))
        .compose(withBookmark(bookmarked))
        .compose(withForecastCount(forecast.map(_.steps.size)))
        .compose(withOpponentSignal(pov))
    )(json)
  }.mon(lila.mon.round.api.player)

  def watcher(
      pov: Pov,
      users: GameUsers,
      tour: Option[TourView],
      tv: Option[lila.round.OnTv],
      initialFenO: Option[Option[Fen.Full]] = None // Preload[Option[Fen.Full]]?
  )(using ctx: Context): Fu[JsObject] = {
    for
      initialFen <- initialFenO.fold(gameRepo.initialFen(pov.game))(fuccess)
      given Translate = ctx.translate
      (json, simul, swiss, note, bookmarked) <-
        (
          jsonView.watcherJson(
            pov,
            users,
            ctx.pref.some,
            ctx.me,
            tv,
            ctx.pref.xiangqiNotationStyle(ctx.lang),
            initialFen,
            ctxFlags
          ),
          pov.game.simulId.so(simulApi.find),
          swissApi.gameView(pov),
          ctx.me.ifTrue(ctx.isMobileApi).so(noteApi.get(pov.gameId, _)),
          bookmarkApi.exists(pov.game, ctx.me)
        ).tupled
    yield (
      withTournament(pov, tour)
        .compose(withSwiss(swiss))
        .compose(withSimul(simul))
        .compose(withNote(note))
        .compose(withBookmark(bookmarked))
        .compose(withSteps(pov))
    )(json)
  }.mon(lila.mon.round.api.watcher)

  private def ctxFlags(using ctx: Context) =
    ExportOptions(
      blurs = Granter.opt(_.ViewBlurs),
      rating = ctx.pref.showRatings,
      nvui = ctx.blind,
      lichobileCompat = HTTPRequest.isLichobile(ctx.req)
    )

  def review(
      pov: Pov,
      users: GameUsers,
      tv: Option[lila.round.OnTv] = None,
      analysis: Option[Analysis] = None,
      initialFen: Option[Fen.Full],
      withFlags: ExportOptions,
      owner: Boolean = false
  )(using ctx: Context): Fu[JsObject] =
    given Translate = ctx.translate
    (
      jsonView.watcherJson(
        pov,
        users,
        ctx.pref.some,
        ctx.me,
        tv,
        ctx.pref.xiangqiNotationStyle(ctx.lang),
        initialFen = initialFen,
        flags = withFlags.copy(blurs = Granter.opt(_.ViewBlurs))
      ),
      tourApi.gameView.analysis(pov.game),
      pov.game.simulId.so(simulApi.find),
      swissApi.gameView(pov),
      ctx.me.ifTrue(ctx.isMobileApi).so(noteApi.get(pov.gameId, _)),
      owner.so(forecastApi.loadForDisplay(pov)),
      bookmarkApi.exists(pov.game, ctx.me)
    ).mapN: (json, tour, simul, swiss, note, fco, bookmarked) =>
      (
        withTournament(pov, tour)
          .compose(withSwiss(swiss))
          .compose(withSimul(simul))
          .compose(withNote(note))
          .compose(withBookmark(bookmarked))
          .compose(withTree(pov, analysis, initialFen, withFlags))
          .compose(withAnalysis(pov.game, analysis))
          .compose(withForecast(pov, fco))
      )(json)
    .flatMap(externalEngineApi.withExternalEngines)
      .mon(lila.mon.round.api.watcher)

  def userAnalysisJson(
      pov: Pov,
      pref: Pref,
      initialFen: Option[Fen.Full],
      orientation: Color,
      owner: Boolean,
      notationStyle: NotationStyle,
      addLichobileCompat: Boolean = false
  )(using Option[Me]) =
    owner
      .so(forecastApi.loadForDisplay(pov))
      .map: fco =>
        withForecast(pov, fco):
          val opts = ExportOptions(lichobileCompat = addLichobileCompat)
          withTree(pov, analysis = none, initialFen, opts):
            jsonView.userAnalysisJson(
              pov,
              pref,
              initialFen,
              orientation,
              owner = owner,
              notationStyle = notationStyle
            )
      .flatMap(externalEngineApi.withExternalEngines)

  private def withTree(
      pov: Pov,
      analysis: Option[Analysis],
      @annotation.unused initialFen: Option[Fen.Full],
      withFlags: ExportOptions
  )(obj: JsObject) =
    obj + ("treeParts" -> lila.tree.XiangqiTreeJson(pov.game, analysis, withFlags))

  private def withSteps(pov: Pov)(obj: JsObject) =
    obj + ("steps" -> lila.round.StepBuilder(pov.game))

  private def withNote(note: String)(json: JsObject) =
    if note.isEmpty then json else json + ("note" -> JsString(note))

  private def withBookmark(v: Boolean)(json: JsObject) =
    json.add("bookmarked" -> v)

  private def withForecastCount(count: Option[Int])(json: JsObject) =
    count.filter(0 !=).fold(json) { c =>
      json + ("forecastCount" -> JsNumber(c))
    }

  private def withOpponentSignal(pov: Pov)(json: JsObject) =
    if pov.game.speed <= chess.Speed.Bullet then
      json.add("opponentSignal", pov.opponent.userId.flatMap(userLag.getLagRating))
    else json

  private def withForecast(pov: Pov, fco: Option[Forecast])(json: JsObject) =
    if pov.game.forecastable then
      json + (
        "forecast" -> {
          if pov.forecastable then
            fco.fold[JsValue](Json.obj("none" -> true)) { fc =>
              import Forecast.given
              Json.toJson(fc)
            }
          else Json.obj("onMyTurn" -> true)
        }
      )
    else json

  private def withAnalysis(g: Game, o: Option[Analysis])(json: JsObject) =
    json.add(
      "analysis",
      o.map { analysisJson.bothPlayers(g.startedAtPly, _, division = divider.forGame(g)) }
    )

  def withTournament(pov: Pov, viewO: Option[TourView])(json: JsObject)(using Translate) =
    json.add("tournament" -> viewO.map { v =>
      Json
        .obj(
          "id" -> v.tour.id,
          "name" -> v.tour.name(full = false),
          "running" -> v.tour.isStarted
        )
        .add("secondsToFinish" -> v.tour.isStarted.option(v.tour.secondsToFinish))
        .add("berserkable" -> v.tour.isStarted.option(v.tour.berserkable))
        // mobile app API BC / should use game.expiration instead
        .add("nbSecondsForFirstMove" -> v.tour.isStarted.option {
          pov.game.timeForFirstMove.toSeconds
        })
        .add("ranks" -> v.ranks)
        .add(
          "top",
          v.top.map:
            lila.tournament.JsonView.top(_, getLightUser)
        )
        .add(
          "team",
          v.teamVs
            .map(_.teams(pov.color))
            .map: id =>
              getLightTeam(id).fold(Json.obj("name" -> id)): team =>
                Json.obj(
                  "name" -> team.name,
                  "flair" -> team.flair
                )
        )
    })

  def withSwiss(sv: Option[SwissView])(json: JsObject) =
    json.add("swiss" -> sv.map: s =>
      Json
        .obj(
          "id" -> s.swiss.id,
          "running" -> s.swiss.isStarted
        )
        .add("ranks" -> s.ranks.map: r =>
          Json.obj(
            "white" -> r.whiteRank,
            "black" -> r.blackRank
          )))

  private def withSimul(simulOption: Option[Simul])(json: JsObject) =
    json.add(
      "simul",
      simulOption.map: simul =>
        Json.obj(
          "id" -> simul.id,
          "hostId" -> simul.hostId,
          "name" -> simul.name,
          "nbPlaying" -> simul.playingPairings.size
        )
    )
