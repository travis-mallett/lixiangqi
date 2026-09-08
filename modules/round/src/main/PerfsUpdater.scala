package lila.round

import chess.ByColor

import lila.core.perf.UserWithPerfs
import lila.core.rank.{ RankChange, RankDiff, RankTrackId }
import lila.rating.XiangqiRank
import lila.user.UserApi

/** Settles the native Xiangqi assessment attached to a ranked game. Puzzle Glicko is unrelated. */
final class PerfsUpdater(
    gameRepo: lila.game.GameRepo,
    userApi: UserApi,
    farming: FarmBoostDetection
)(using Executor):

  def save(game: Game, users: ByColor[UserWithPerfs]): Fu[Option[ByColor[RankChange]]] =
    if !game.rankTrack.contains(RankTrackId.xiangqi) || !game.finished || game.playedPlies < 2 then
      fuccess(none)
    else persistedChanges(game).fold(settle(game, users))(changes => fuccess(changes.some))

  private def persistedChanges(game: Game): Option[ByColor[RankChange]] =
    game.players.traverse: player =>
      for
        snapshot <- player.rank
        diff <- snapshot.diff
        after <- snapshot.after
      yield RankChange(diff, after)

  private def settle(game: Game, users: ByColor[UserWithPerfs]): Fu[Option[ByColor[RankChange]]] =
    for
      isBotFarming <- farming.botFarming(game)
      isBoosting <- farming.newAccountBoosting(game, users)
      result <- (!isBotFarming && !isBoosting).so:
        calculate(game, users).so(diffs => persist(game, users, diffs))
    yield result

  /** The result value comes exclusively from immutable game-start snapshots. */
  private def calculate(game: Game, users: ByColor[UserWithPerfs]): Option[ByColor[RankDiff]] = for
    outcome <- game.outcome
    if !users.exists(_.user.lame)
    snapshots <- game.players.traverse(_.rank)
    if snapshots.forall(_.track == RankTrackId.xiangqi)
    settlement <- XiangqiRank
      .settle(snapshots.white, snapshots.black, outcome)
      .left
      .map(message => logger.warn(s"Cannot settle native rank for game ${game.id}: $message"))
      .toOption
  yield ByColor(settlement.red, settlement.black)

  private def persist(
      game: Game,
      users: ByColor[UserWithPerfs],
      diffs: ByColor[RankDiff]
  ): Fu[Option[ByColor[RankChange]]] =
    val drawn = game.outcome.exists(_.winner.isEmpty)
    users
      .mapWithColor: (color, user) =>
        userApi.updateRankAtomically(user.id, RankTrackId.xiangqi, XiangqiRank.initial): perf =>
          XiangqiRank.applyResult(
            perf = perf,
            delta = diffs(color),
            won = game.winnerColor.contains(color),
            drawn = drawn,
            at = game.movedAt,
            gameId = game.id
          )
      .sequence
      .flatMap: updates =>
        val current = updates.map(_._2)
        val actualDiffs = current.map: perfs =>
          perfs
            .rank(RankTrackId.xiangqi)
            .flatMap(_.settlement(game.id))
            .getOrElse(RankDiff.zero)
        val updatedUsers = users.zip(current, (user, perfs) => user.copy(perfs = perfs))
        val changes = actualDiffs.zip(
          current,
          (diff, perfs) =>
            RankChange(
              diff,
              XiangqiRank.catalog.code(perfs.rank(RankTrackId.xiangqi).getOrElse(XiangqiRank.initial).score)
            )
        )
        lila.common.Bus.pub(lila.core.game.PerfsUpdate(game, updatedUsers))
        gameRepo.setRankChanges(game.id, changes).inject(changes.some)
