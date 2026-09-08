package lila.mod

import lila.core.game.GameRepo
import lila.core.rank.{ RankDiff, RankTrackId }
import lila.core.rank.RankDiff.*
import lila.db.dsl.*
import lila.game.Query
import lila.rating.XiangqiRank
import lila.report.Suspect
import lila.user.UserApi

/** Restores the exact native Xiangqi points lost to a player later marked for engine use. */
final private class RankRefund(
    gameRepo: GameRepo,
    userApi: UserApi,
    scheduler: Scheduler,
    notifier: ModNotifier,
    logApi: ModlogApi
)(using Executor):

  import RankRefund.*
  import gameRepo.gameHandler

  def schedule(suspect: Suspect): Unit = scheduler.scheduleOnce(delay)(apply(suspect))

  private def apply(suspect: Suspect): Funit =
    val since = nowInstant.minusDays(5)
    logApi
      .wasUnengined(suspect, since.some)
      .flatMap:
        if _ then funit
        else
          gameRepo.coll
            .find(
              Query.user(suspect.user.id) ++ Query.ranked ++ Query.createdSince(since) ++ Query.finished
            )
            .sort(Query.sortCreated)
            .cursor[Game](ReadPref.sec)
            .list(40)
            .map(refunds(suspect, _))
            .flatMap(_.parallelVoid(applyRefund))

  private def refunds(suspect: Suspect, games: List[Game]): List[Refund] =
    games
      .foldLeft(Map.empty[UserId, List[(GameId, RankDiff)]]): (all, game) =>
        val lost = for
          opponent <- game.opponentOf(suspect.user)
          victim <- opponent.userId
          rank <- opponent.rank
          if rank.track == RankTrackId.xiangqi
          diff <- rank.diff
          if diff.value < 0
        yield victim -> (game.id -> RankDiff(-diff.value))
        lost.fold(all): (victim, loss) =>
          all.updated(victim, loss :: all.getOrElse(victim, Nil))
      .map((victim, losses) => Refund(victim, losses))
      .toList

  private def applyRefund(refund: Refund): Funit =
    userApi
      .withPerfs(refund.victim)
      .flatMapz: victim =>
        if victim.perfs.rank(RankTrackId.xiangqi).isEmpty then funit
        else
          userApi
            .updateRankAtomically(victim.id, RankTrackId.xiangqi, XiangqiRank.initial): perf =>
              XiangqiRank.restoreLosses(perf, refund.losses)._1
            .flatMap: (before, after) =>
              val restored = for
                oldRank <- before.rank(RankTrackId.xiangqi)
                newRank <- after.rank(RankTrackId.xiangqi)
              yield newRank.score.value - oldRank.score.value
              restored.filter(_ > 0).so(points => notifier.rankRefund(victim.user, points))

private object RankRefund:

  val delay = 1.minute

  case class Refund(victim: UserId, losses: List[(GameId, RankDiff)])
