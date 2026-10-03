package lila.relay

import scalalib.paginator.Paginator

import lila.core.playerDirectory.Player
import lila.db.dsl.{ *, given }
import lila.study.ChapterRepo

final class RelayPlayerTour(
    colls: RelayColls,
    chapterRepo: ChapterRepo,
    pager: RelayPager,
    cacheApi: lila.memo.CacheApi
)(using Executor):

  private val tourIdsCache =
    cacheApi[lila.core.playerDirectory.PlayerId, List[RelayTourId]](256, "relay.player.tourIds"):
      _.expireAfterWrite(10.minutes).buildAsyncFuture: playerId =>
        chapterRepo
          .studyIdsByRelayPlayerId(playerId)
          .flatMap: studyIds =>
            colls.round.distinctEasy[RelayTourId, List]("tourId", $inIds(studyIds))

  def playerTours(player: Player, page: Int): Fu[Paginator[RelayTour.WithLastRound]] =
    tourIdsCache
      .get(player.id)
      .flatMap:
        pager.byIds(_, page)
