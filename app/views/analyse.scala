package views.analyse

import chess.format.pgn.PgnStr
import play.api.libs.json.{ Json, JsObject }

import lila.app.UiEnv.{ *, given }
import lila.round.RoundGame.secondsSinceCreation

val ui = lila.analyse.ui.AnalyseUi(helpers)(analyseEndpoints)

object replay:

  private val replayUi = lila.analyse.ui.ReplayUi(helpers)(ui)

  def forCrawler(
      pov: Pov,
      initialFen: Option[chess.format.Fen.Full],
      pgn: PgnStr,
      simul: Option[lila.simul.Simul],
      cross: Option[lila.game.Crosstable.WithMatchup]
  )(using Context) =
    replayUi.forCrawler(
      pov,
      pgn,
      views.round.ui.povOpenGraph(pov),
      chessground = views.round.ui.povChessground(pov),
      gameSide = views.game.side(pov, initialFen, none, simul = simul, bookmarked = false),
      crosstable = cross.map: c =>
        views.game.ui.crosstable(pov.player.userId.fold(c)(c.fromPov), pov.gameId.some)
    )

  def forBrowser(
      pov: Pov,
      data: play.api.libs.json.JsObject,
      initialFen: Option[chess.format.Fen.Full],
      pgn: PgnStr,
      analysis: Option[lila.analyse.Analysis],
      analysisStarted: Boolean,
      simul: Option[lila.simul.Simul],
      cross: Option[lila.game.Crosstable.WithMatchup],
      userTv: Option[User],
      chatOption: Option[lila.chat.UserChat.Mine],
      bookmarked: Boolean
  )(using ctx: Context) =

    val chatOpt = chatOption.map: c =>
      views.chat.json(
        c.chat,
        c.lines,
        name = trans.site.spectatorRoom.txt(),
        timeout = c.timeout,
        withNoteAge = ctx.isAuth.option(pov.game.secondsSinceCreation),
        public = true,
        resource = lila.core.chat.PublicSource.Watcher(pov.gameId),
        voiceChat = ctx.canVoiceChat
      ) -> views.chat.frag

    val side = views.game.side(pov, initialFen, none, simul = simul, userTv = userTv, bookmarked = bookmarked)

    replayUi.forBrowser(
      pov,
      data,
      pgn,
      analysable = lila.game.GameExt.analysable(pov.game),
      hasAnalysis = analysis.isDefined || analysisStarted,
      graph = views.round.ui.povOpenGraph(pov),
      gameSide = side,
      crosstable = cross.map: c =>
        views.game.ui.crosstable(pov.player.userId.fold(c)(c.fromPov), pov.gameId.some),
      chatOption = chatOpt
    )

object embed:

  def userAnalysis(data: JsObject)(using ctx: EmbedContext) =
    views.base.embed.site(
      title = trans.site.analysis.txt(),
      cssKeys = List("analyse.free.embed"),
      pageModule = ui.bits
        .analyseModule("userAnalysis", Json.obj("data" -> data, "embed" -> true) ++ ui.explorerAndCevalConfig)
        .some,
      csp = _.withExternalAnalysisApis.withWebAssembly,
      i18nModules = List(_.site, _.timeago, _.study, _.preferences)
    )(
      ui.bits.embedUserAnalysisBody,
      views.base.page.ui.inlineJs(ctx.nonce, Nil)
    )

  def lpv(pgn: PgnStr, @annotation.unused getPgn: Boolean, @annotation.unused title: String, args: JsObject)(
      using ctx: EmbedContext
  ) =
    views.boardViewer(args ++ Json.obj("pgn" -> pgn.value))

  def notFound(using EmbedContext) =
    views.base.embed.minimal(
      title = "404 - Game not found",
      cssKeys = List("viewer.embed")
    ):
      div(cls := "not-found")(h1("Game not found"))
