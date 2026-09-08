package views.round

import play.api.libs.json.Json

import lila.app.UiEnv.{ *, given }
import lila.common.Json.given
import lila.round.RoundGame.secondsSinceCreation
import lila.round.UrgentGames

def player(
    pov: Pov,
    data: play.api.libs.json.JsObject,
    tour: Option[lila.tournament.GameView],
    simul: Option[lila.simul.Simul],
    cross: Option[lila.game.Crosstable.WithMatchup],
    playing: UrgentGames,
    chatOption: Option[lila.chat.Chat.GameOrEvent],
    bookmarked: Boolean
)(using ctx: Context) =

  ui.RoundPage(pov.game.variant, pageTitle(pov))
    .js(roundNvuiTag)
    .js(PageModule("round", moduleData(pov, data, chatOption)))
    .graph(ui.povOpenGraph(pov))
    .flag(_.zen)
    .flag(_.playing, pov.game.playable):
      mainContent(pov, data, tour, simul, cross, playing, chatOption, bookmarked)

def playerBootstrap(
    pov: Pov,
    data: play.api.libs.json.JsObject,
    tour: Option[lila.tournament.GameView],
    simul: Option[lila.simul.Simul],
    cross: Option[lila.game.Crosstable.WithMatchup],
    playing: UrgentGames,
    chatOption: Option[lila.chat.Chat.GameOrEvent],
    bookmarked: Boolean
)(using ctx: Context) =
  val title = pageTitle(pov)
  val documentTitle =
    if env.mode.isProd then s"$title • $siteName"
    else s"${ctx.me.so(_.username.value + " ")}$title • $siteName"
  Json.obj(
    "html" -> mainContent(pov, data, tour, simul, cross, playing, chatOption, bookmarked).render,
    "url" -> routes.Round.player(pov.fullId).url,
    "title" -> documentTitle,
    "options" -> moduleData(pov, data, chatOption)
  )

private def pageTitle(pov: Pov)(using ctx: Context) =
  val opponentNameOrZen = if ctx.pref.isZen || ctx.pref.isZenAuto then "ZEN" else playerText(pov.opponent)
  s"${trans.site.play.txt()} $opponentNameOrZen"

private def moduleData(
    pov: Pov,
    data: play.api.libs.json.JsObject,
    chatOption: Option[lila.chat.Chat.GameOrEvent]
)(using ctx: Context) =
  Json
    .obj(
      "data" -> data,
      "userId" -> ctx.userId,
      "chat" -> chatJson(pov, chatOption)
    )
    .add("noab" -> (pov.game.hasAi || ctx.me.exists(_.marks.engine)))

private def chatJson(pov: Pov, chatOption: Option[lila.chat.Chat.GameOrEvent])(using ctx: Context) =

  chatOption
    .map(_.either)
    .map:
      case Left(c) =>
        views.chat.restrictedJson(
          c,
          c.lines,
          name = trans.site.chatRoom.txt(),
          timeout = false,
          withNoteAge = ctx.isAuth.option(pov.game.secondsSinceCreation),
          public = false,
          resource = lila.core.chat.PublicSource.Player(pov.gameId),
          voiceChat = ctx.canVoiceChat,
          opponentId = pov.opponent.userId
        )
      case Right((c, res)) =>
        views.chat.json(
          c.chat,
          c.lines,
          name = trans.site.chatRoom.txt(),
          timeout = c.timeout,
          public = true,
          resource = res,
          opponentId = pov.opponent.userId
        )

private def mainContent(
    pov: Pov,
    data: play.api.libs.json.JsObject,
    tour: Option[lila.tournament.GameView],
    simul: Option[lila.simul.Simul],
    cross: Option[lila.game.Crosstable.WithMatchup],
    playing: UrgentGames,
    chatOption: Option[lila.chat.Chat.GameOrEvent],
    bookmarked: Boolean
)(using ctx: Context) =
  main(cls := "round")(
    st.aside(cls := "round__side")(
      side(pov, data, tour.map(_.tourAndTeamVs), simul, bookmarked = bookmarked),
      chatOption.map(_ => views.chat.frag)
    ),
    ui.roundAppPreload(pov),
    div(cls := "round__underboard")(
      views.game.ui.crosstable.option(cross, pov.game),
      (playing.value.nonEmpty || simul.exists(_.isHost(ctx.me))).option(
        div(cls := "round__now-playing")(
          ui.others(playing, simul.filter(_.isHost(ctx.me)).map(views.simul.ui.roundOtherGames))
        )
      )
    ),
    div(cls := "round__underchat")(underchat(pov.game))
  )
