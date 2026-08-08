package lila.round
package ui

import chess.variant.Variant

import lila.ui.*
import lila.ui.ScalatagsTemplate.{ *, given }

final class RoundUi(helpers: Helpers, gameUi: lila.game.ui.GameUi):
  import helpers.{ *, given }

  def RoundPage(@annotation.unused variant: Variant, title: String)(using
      @annotation.unused ctx: Context
  ) =
    Page(title)
      .css("round")
      .flag(_.zoom)
      .flag(_.crossSiteIsolation)
      .csp(_.withPeer.withWebAssembly)

  def povOpenGraph(pov: Pov)(using Translate) =
    OpenGraph(
      image = cdnUrl(routes.Export.gameThumbnail(pov.gameId, None, None).url).some,
      title = titleGame(pov.game),
      url = routeUrl(routes.Round.watcher(pov.gameId, pov.color)),
      description = describePov(pov)
    )

  def others(playing: UrgentGames, simul: Option[Frag])(using Context) =
    val switchId = "round-toggle-autoswitch"
    frag(
      h3(
        simul | frag(trans.site.currentGames()),
        form3.cmnToggleWrap(st.title := trans.site.automaticallyProceedToNextGameAfterMoving.txt())(
          trans.site.autoSwitch(),
          form3.cmnToggle(switchId, switchId, checked = false)
        )
      ),
      div(cls := "now-playing"):
        val (myTurn, otherTurn) = playing.value.partition(_.isMyTurn)
        (myTurn ++ otherTurn.take(8 - myTurn.size))
          .take(12)
          .map: pov =>
            a(href := routes.Round.player(pov.fullId), cls := pov.isMyTurn.option("my_turn"))(
              span(
                cls := s"mini-game mini-game--init ${pov.game.variant.key} is2d",
                gameUi.mini.renderState(pov)
              )(gameUi.mini.cgWrap),
              span(cls := "meta")(
                playerUsername(
                  pov.opponent.light,
                  pov.opponent.userId.flatMap(lightUserSync),
                  withRating = false,
                  withTitle = true
                ),
                span(cls := "indicator")(
                  if pov.isMyTurn then
                    pov.remainingSeconds
                      .fold[Frag](trans.site.yourTurn())(secondsFromNow(_, alwaysRelative = true))
                  else nbsp
                )
              )
            )
    )

  def describePov(pov: Pov)(using Translate) =
    import pov.*
    val p1 = playerText(game.whitePlayer, withRating = true)
    val p2 = playerText(game.blackPlayer, withRating = true)
    val plays = if game.finishedOrAborted then "played" else "is playing"
    val speedAndClock =
      if game.sourceIs(_.Import) then "imported"
      else
        game.clock.fold(chess.Speed.Correspondence.name): c =>
          val clockName = game.moveTimeLimit.fold(c.config.show): limit =>
            s"${c.config.show} · ${shortMoveTimeLimitName(limit)}"
          s"${chess.Speed(c.config).name} ($clockName)"

    val rated = game.rated.name
    val variant =
      if game.fromPosition then "a custom Xiangqi position"
      else "Xiangqi"
    import chess.Status.*
    val result = (game.winner, game.loser, game.status) match
      case (Some(w), _, Mate) => s"${playerText(w)} won by checkmate"
      case (_, _, Aborted | NoStart) => gameUi.abortReason(game).txt()
      case (_, Some(l), Resign | Timeout | Cheat | NoStart) => s"${playerText(l)} resigned"
      case (_, Some(l), Outoftime) => s"${playerText(l)} ran out of time"
      case (Some(w), _, UnknownFinish | VariantEnd) => s"${playerText(w)} won"
      case (_, _, Draw | Stalemate | UnknownFinish) => "Game is a draw"
      case _ if game.finished => "Game ended"
      case _ => "Game is still ongoing"
    val moves = (game.ply.value - game.startedAtPly.value + 1) / 2
    s"$p1 $plays $p2 in a $rated $speedAndClock game of $variant. $result after ${pluralize("move", moves)}. Click to replay, analyse, and discuss the game!"

  def povChessground(pov: Pov)(using @annotation.unused ctx: Context): Frag =
    xiangqiGround(
      fen = pov.game.position.fen,
      color = pov.color,
      lastMove = pov.game.lastMoveKeys,
      blindfold = pov.player.blindfold
    )

  def roundAppPreload(pov: Pov)(using Context): Tag =
    div(cls := "round__app")(
      div(cls := "round__app__board main-board xiangqi9x10")(povChessground(pov)),
      div(cls := "col1-rmoves-preload")
    )
