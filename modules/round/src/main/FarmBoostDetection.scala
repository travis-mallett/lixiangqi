package lila.round

import scalalib.future.FutureAfter
import chess.ByColor

import lila.core.LightUser.IsBotSync
import lila.core.perf.UserWithPerfs
import lila.game.{ CrosstableApi, GameRepo }
import lila.core.game.reasonableMinimumNumberOfMoves
import lila.core.rank.RankTrackId
import lila.core.rank.RankScore.*

final private class FarmBoostDetection(
    gameRepo: GameRepo,
    crosstableApi: CrosstableApi,
    securityApi: lila.core.security.SecurityApi,
    isBotSync: IsBotSync
)(using Executor, FutureAfter):

  val SAME_PLIES = 20
  val PREV_GAMES = 2

  /* true if
   * - at least one bot
   * - ranked
   * - recent game in same matchup has same first SAME_PLIES and same winner
   */
  def botFarming(g: Game): Fu[Boolean] =
    (g.finished && g.ranked && g.userIds.exists(isBotSync))
      .so(g.twoUserIds)
      .so: (u1, u2) =>
        crosstableApi(u1, u2).flatMap: ct =>
          gameRepo
            .gamesFromSecondary(ct.results.reverse.take(PREV_GAMES).map(_.gameId))
            .map:
              _.exists: prev =>
                g.nativeVariant == prev.nativeVariant && g.winnerUserId === prev.winnerUserId &&
                  g.sans.take(SAME_PLIES) === prev.sans.take(SAME_PLIES)
            .addEffect:
              if _ then lila.mon.round.farming.bot.increment()

  def newAccountBoosting(g: Game, users: ByColor[UserWithPerfs]): Fu[Boolean] =
    newAccountBoostingWin(g, users) >>| newAccountBoostingDraw(g, users)

  private def newAccountBoostingDraw(g: Game, users: ByColor[UserWithPerfs]): Fu[Boolean] =
    (g.status == chess.Status.Draw).so:
      g.players.zipColor
        .find: (c, player) =>
          player.rank.exists: rank =>
            g.player(!c).rank.exists(_.score.value > rank.score.value)
        ._1F // color of the lower-ranked player
        .so(newAccountBoostingInFavorOf(g, users, _))

  private def newAccountBoostingWin(g: Game, users: ByColor[UserWithPerfs]): Fu[Boolean] =
    g.winnerColor.so(newAccountBoostingInFavorOf(g, users, _))

  private def newAccountBoostingInFavorOf(g: Game, users: ByColor[UserWithPerfs], favor: Color): Fu[Boolean] =
    val account = g.rankTrack.getOrElse(RankTrackId.xiangqi)
    val games = users(favor).perfs.rank(account).fold(0)(_.games)
    FarmBoostDetection
      .needsRelationCheck(g, users(favor).user.createdAt, nowInstant, games)
      .so(arePlayersRelated(g))
      .addEffect:
        if _ then
          lila.mon.round.farming.provisional.increment()
          logger.info(s"new account boosting: https://lixiangqi.org/${g.id} ${users.map(_.user.username)}")

  private def arePlayersRelated(game: Game): Fu[Boolean] =
    if game.sourceIs(_.Friend) then fuTrue
    else
      game.userIdPair.sequence
        .map(_.toPair)
        .so(securityApi.shareAnIpOrFp)

object FarmBoostDetection:
  def needsRelationCheck(game: Game, joined: Instant, at: Instant, games: Int): Boolean =
    val minSeconds = linearInterpolation(games)(0 -> 90, 5 -> 60)
    val minPlies = if game.variant.standard then linearInterpolation(games)(0 -> 40, 5 -> 20)
    else reasonableMinimumNumberOfMoves(game.variant)
    !joined.isBefore(at.minusDays(7)) && ((games < 6 && game.playedPlies < minPlies &&
      game.durationSeconds.exists(_ < minSeconds)) || game.playedPlies < 10)

  private def linearInterpolation(x: Int)(p1: PairOf[Int], p2: PairOf[Int]): Int =
    val ((x1, y1), (x2, y2)) = (p1, p2)
    y1 + (x - x1) * (y2 - y1) / (x2 - x1)
