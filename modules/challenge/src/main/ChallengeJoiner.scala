package lila.challenge

import chess.ByColor

import lila.core.user.GameUser
import lila.xiangqi.Xiangqi

final private class ChallengeJoiner(
    gameRepo: lila.game.GameRepo,
    userApi: lila.core.user.UserApi,
    mayPlayRatedFriend: lila.core.pool.MayPlayRatedFriend,
    participation: lila.core.pool.PoolParticipation,
    onStart: lila.core.game.OnStart
)(using Executor, Scheduler):

  def apply(c: Challenge, destUser: GameUser): FuRaise[String, Pov] = for
    exists <- gameRepo.exists(c.gameId)
    _ <- raiseIf(exists)("The challenge has already been accepted")
    origUser <- c.challengerUserId.so(
      userApi.byIdWithPerf(_, c.perfType, c.accountTrack)
    )
    game <- ChallengeJoiner.createGame(c, origUser, destUser).raiseIfLeft
    allowed <-
      if game.ranked && game.daysPerTurn.isEmpty then
        List(origUser, destUser).flatten
          .traverse(u => mayPlayRatedFriend.exec(u.user))
          .map(_.forall(identity))
      else fuTrue
    _ <- raiseIf(
      !allowed || (game.ranked && game.daysPerTurn.isEmpty && !participation
        .reserveChallenge(game.userIds, game.id, nowMillis))
    )("A player is unavailable for a rated game")
    _ <- gameRepo
      .insertDenormalized(game)
      .recoverWith:
        case e if game.ranked =>
          gameRepo
            .exists(game.id)
            .flatMap: persisted =>
              if !persisted then participation.release(game.id, game.userIds)
              fufail(e)
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
    for
      _ <- Either.cond(
        c.rated.no || List(origUser, destUser).forall(_.exists(u => u.user.rankable && !u.user.isBot)),
        (),
        "Rated challenges require two eligible members"
      )
      setup <- gameSetup(c)
      game = createGame(c, origUser, destUser, setup)
      _ <- Either.cond(
        c.rated.no || game.ranked,
        (),
        "Rated challenges require compatible ranks and pool settings"
      )
    yield game

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
        rated = c.rated,
        source = lila.core.game.Source.Friend,
        daysPerTurn = c.daysPerTurn,
        pgnImport = None,
        rules = c.rules,
        clock = c.timeControl.realTime.map(_.toClock),
        moveTimeLimit = c.clock.flatMap(_.moveTimeLimit),
        startedAtPly = chess.Ply(xiangqiGame.state.ply),
        rankTrack = (c.rated.yes || (c.daysPerTurn.isDefined && c.rules.isEmpty && List(origUser, destUser)
          .forall(_.exists(u => u.user.rankable && !u.user.lame)))).option(c.accountTrack),
        variant = c.variant
      )
      .withId(c.gameId)
      .start

  def gameSetup(c: Challenge): Either[String, Xiangqi.Game] =
    c.gameVariant.initialGame(
      c.initialFen
        .filter(_ => c.variant.fromPosition)
        .map(_.value),
      c.effectiveRuleset
    )
