package lila.challenge

import chess.ByColor

import lila.core.user.GameUser
import lila.xiangqi.{ Xiangqi, XiangqiRules }

final private class ChallengeJoiner(
    gameRepo: lila.game.GameRepo,
    userApi: lila.core.user.UserApi,
    onStart: lila.core.game.OnStart
)(using Executor, Scheduler):

  def apply(c: Challenge, destUser: GameUser): FuRaise[String, Pov] = for
    exists <- gameRepo.exists(c.gameId)
    _ <- raiseIf(exists)("The challenge has already been accepted")
    origUser <- c.challengerUserId.so(userApi.byIdWithPerf(_, c.perfType))
    game <- ChallengeJoiner.createGame(c, origUser, destUser).raiseIfLeft
    _ <- gameRepo.insertDenormalized(game)
    _ <- onStartOrRetry(game.id).recover: _ =>
      logger.error(s"onStart failed for game ${game.id}")
  yield Pov(game, !c.finalColor)

  private def onStartOrRetry(id: GameId, retries: Int = 3): Funit =
    onStart
      .exec(id)
      .recoverWith:
        case _ if retries > 0 =>
          logger.warn(s"onStart failed for game $id. Retries left: $retries")
          lila.common.LilaFuture.delay(500.millis)(onStartOrRetry(id, retries - 1))
      .void

private object ChallengeJoiner:

  def createGame(
      c: Challenge,
      origUser: GameUser,
      destUser: GameUser
  ): Either[String, Game] =
    gameSetup(c).map(createGame(c, origUser, destUser, _))

  private[challenge] def createGame(
      c: Challenge,
      origUser: GameUser,
      destUser: GameUser,
      xiangqiGame: Xiangqi.Game
  ): Game =
    lila.core.game
      .newGame(
        xiangqi = xiangqiGame,
        players = ByColor: color =>
          lila.game.Player.make(color, if c.finalColor == color then origUser else destUser),
        rated = c.rated.map(_ && xiangqiGame.initialFen == Xiangqi.startFen),
        source = lila.core.game.Source.Friend,
        daysPerTurn = c.daysPerTurn,
        pgnImport = None,
        rules = c.rules,
        clock = c.timeControl.realTime.map(_.toClock),
        moveTimeLimit = c.clock.flatMap(_.moveTimeLimit),
        startedAtPly = chess.Ply(xiangqiGame.state.ply),
        variant = c.variant
      )
      .withId(c.gameId)
      .start

  def gameSetup(c: Challenge): Either[String, Xiangqi.Game] =
    XiangqiRules.initialGame:
      c.initialFen
        .filter(_ => c.variant.fromPosition)
        .map(_.value)
