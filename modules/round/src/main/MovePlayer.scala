package lila.round

import chess.{ Centis, MoveMetrics, Status }

import java.util.concurrent.TimeUnit

import lila.common.Bus
import lila.core.round.*
import lila.game.GameExt.applyMove
import lila.game.actorApi.MoveGameEvent
import lila.game.{ Progress, UciMemo }
import lila.round.RoundGame.*
import lila.xiangqi.{ Xiangqi, XiangqiRules }

final private class MovePlayer(
    finisher: Finisher,
    scheduleExpiration: ScheduleExpiration,
    uciMemo: UciMemo
)(using Executor):

  sealed private trait MoveResult
  private case object Flagged extends MoveResult
  private case class MoveApplied(
      progress: Progress,
      move: Xiangqi.MoveResult,
      compedLag: Option[Centis]
  ) extends MoveResult

  private[round] def human(play: HumanPlay, round: RoundAsyncActor)(
      pov: Pov
  )(using proxy: GameProxy): Fu[Events] =
    import pov.{ game, color }
    if game.ply > lila.game.Game.maxPlies then
      round ! TooManyPlies
      fuccess(Nil)
    else if game.playableBy(color) then
      applyUci(game, play.uci, play.blur, play.moveMetrics)
        .fold(error => fufail(ClientError(s"$pov $error")), fuccess)
        .flatMap:
          case Flagged => finisher.outOfTime(game)
          case MoveApplied(progress, move, compedLag) =>
            compedLag.foreach: lag =>
              lila.mon.round.move.lag.moveComp.record(lag.millis, TimeUnit.MILLISECONDS)
            proxy.save(progress) >>
              postHumanOrBotPlay(round, pov, progress, move)
    else if game.finished then fufail(GameIsFinishedError(game.id))
    else if game.aborted then fufail(ClientError(s"$pov game is aborted"))
    else if !game.turnOf(color) then fufail(ClientError(s"$pov not your turn"))
    else fufail(ClientError(s"$pov move refused for some reason"))

  private[round] def bot(
      uci: Xiangqi.Uci,
      round: RoundAsyncActor
  )(pov: Pov)(using proxy: GameProxy): Fu[Events] =
    import pov.{ game, color }
    if game.ply > lila.game.Game.maxPlies then
      round ! TooManyPlies
      fuccess(Nil)
    else if game.playableBy(color) then
      applyUci(game, uci, blur = false, botLag)
        .fold(error => fufail(ClientError(error)), fuccess)
        .flatMap:
          case Flagged => finisher.outOfTime(game)
          case MoveApplied(progress, move, _) =>
            proxy.save(progress) >> postHumanOrBotPlay(round, pov, progress, move)
    else if game.finished then fufail(GameIsFinishedError(game.id))
    else if game.aborted then fufail(ClientError(s"$pov game is aborted"))
    else if !game.turnOf(color) then fufail(ClientError(s"$pov not your turn"))
    else fufail(ClientError(s"$pov move refused for some reason"))

  private def postHumanOrBotPlay(
      round: RoundAsyncActor,
      pov: Pov,
      progress: Progress,
      move: Xiangqi.MoveResult
  )(using GameProxy): Fu[Events] =
    if pov.game.hasAi then uciMemo.add(pov.game, move.move)
    notifyMove(move, progress.game)
    if progress.game.finished then moveFinish(progress.game).dmap { progress.events ::: _ }
    else
      if progress.game.playableByAi then requestFishnet(progress.game, round)
      if pov.opponent.isOfferingDraw then round ! RoundBus.Draw(pov.player.id, false)
      if pov.opponent.isProposingTakeback then round ! RoundBus.Takeback(pov.player.id, false)
      if progress.game.forecastable then round ! ForecastPlay(move.move)
      scheduleExpiration.exec(progress.game)
      fuccess(progress.events)

  private[round] def fishnet(
      game: Game,
      sign: String,
      uci: Xiangqi.Uci
  )(using proxy: GameProxy): Fu[Events] =
    if game.playable && game.player.isAi then
      uciMemo
        .sign(game)
        .flatMap: expectedSign =>
          if expectedSign != sign then
            fufail:
              FishnetError:
                s"Invalid game hash: $sign id: ${game.id} playable: ${game.playable} player: ${game.player}"
          else
            applyUci(game, uci, blur = false, metrics = fishnetLag)
              .fold(error => fufail(ClientError(error)), fuccess)
              .flatMap:
                case Flagged => finisher.outOfTime(game)
                case MoveApplied(progress, move, _) =>
                  for
                    _ <- proxy.save(progress)
                    _ =
                      uciMemo.add(progress.game, move.move)
                      lila.mon.fishnet.move(~game.aiLevel).increment()
                      notifyMove(move, progress.game)
                    events <-
                      if progress.game.finished then moveFinish(progress.game).dmap { progress.events ::: _ }
                      else fuccess(progress.events)
                  yield events
    else
      fufail:
        FishnetError:
          s"Not AI turn move: ${uci.value} id: ${game.id} playable: ${game.playable} player: ${game.player}"

  private[round] def requestFishnet(game: Game, round: RoundAsyncActor): Unit =
    game.playableByAi.so:
      if game.ply <= lila.core.fishnet.maxPlies then Bus.pub(lila.core.fishnet.FishnetMoveRequest(game))
      else round ! ResignAi

  private val fishnetLag = MoveMetrics(clientLag = Centis(5).some)
  private val botLag = MoveMetrics(clientLag = Centis(0).some)

  private def applyUci(
      game: Game,
      uci: Xiangqi.Uci,
      blur: Boolean,
      metrics: MoveMetrics
  ): Either[String, MoveResult] =
    val steppedClock = game.clock.map(_.step(metrics))
    XiangqiRules
      .move(game.xiangqi, uci)
      .flatMap: move =>
        game.xiangqi
          .applyMove(move)
          .map: next =>
            steppedClock match
              case Some(stepped)
                  if stepped.value.outOfTime(game.turnColor, withGrace = false) ||
                    game.moveTimeOutAfterCompensation(stepped.compensated) =>
                Flagged
              case _ =>
                MoveApplied(
                  game.applyMove(next, move, steppedClock.map(_.value), blur),
                  move,
                  steppedClock.flatMap(_.compensated)
                )

  private def notifyMove(move: Xiangqi.MoveResult, game: Game): Unit =
    import lila.core.round.{ CorresMoveEvent, MoveEvent, SimulMoveEvent }
    val color = !game.turnColor
    val moveEvent = MoveEvent(
      gameId = game.id,
      fen = game.position.fen,
      move = move.move
    )

    Bus.publishDyn(MoveGameEvent(game, moveEvent.fen, moveEvent.move), MoveGameEvent.makeChan(game.id))

    if game.isCorrespondence && game.nonAi then
      Bus.pub:
        CorresMoveEvent(
          move = moveEvent,
          playerUserId = game.player(color).userId,
          mobilePushable = game.mobilePushable,
          alarmable = game.alarmable,
          unlimited = game.isUnlimited
        )

    for
      simulId <- game.simulId
      opponentUserId <- game.player(!color).userId
      event = SimulMoveEvent(move = moveEvent, simulId = simulId, opponentUserId = opponentUserId)
    yield Bus.pub(event)

  private def moveFinish(game: Game)(using GameProxy): Fu[Events] =
    game.status match
      case Status.Mate => finisher.other(game, _.Mate, game.winnerColor)
      case Status.VariantEnd => finisher.other(game, _.VariantEnd, game.winnerColor)
      case status @ (Status.Stalemate | Status.Draw) => finisher.other(game, _ => status, None)
      case _ => fuccess(Nil)
