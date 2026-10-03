package lila.relay

import lila.xiangqi.Xiangqi.Side
import lila.study.StudyPgnTags

import scalalib.cache.OnceEvery
import scalalib.StringOps.addQueryParam

import lila.core.notify.{ NotifyApi, NotificationContent }
import lila.study.Chapter

final private class RelayNotifier(
    notifyApi: NotifyApi,
    tourRepo: RelayTourRepo,
    getPlayerFollowers: lila.core.playerDirectory.GetPlayerFollowers
)(using Executor):

  private object notifyPlayerFollowers:

    private val dedupByChapterSide = OnceEvery[(StudyChapterId, Side)](1.day)
    private val dedupByRoundPlayerId = OnceEvery[(RelayRoundId, lila.core.playerDirectory.PlayerId)](1.day)

    def ofSide(rt: RelayRound.WithTour, chapter: Chapter)(color: Side): Funit =
      StudyPgnTags
        .playerIds(chapter.tags)(color)
        .zip(StudyPgnTags.names(chapter.tags)(color))
        .so: (playerId, name) =>
          val unique =
            dedupByChapterSide(chapter.id -> color) && dedupByRoundPlayerId(rt.round.id -> playerId)
          unique.so:
            for
              followers <- getPlayerFollowers(playerId)
              opponent = StudyPgnTags
                .names(chapter.tags)(!color)
                .map(name => s" against ${name} ")
                .getOrElse(" ")
              _ <- notifyApi.notifyMany(
                followers,
                NotificationContent.BroadcastRound(
                  url = addQueryParam(rt.call(chapter.id).url, "pov", color.key),
                  title = rt.tour.name.value,
                  text = s"${name} is playing${opponent}in ${rt.round.name}"
                )
              )
            yield ()

  private object notifyTournamentSubscribers:

    private val dedupDbReq = OnceEvery[RelayRoundId](3.hours)

    def apply(rt: RelayRound.WithTour): Funit =
      dedupDbReq(rt.round.id).so:
        tourRepo
          .hasNotified(rt)
          .not
          .flatMapz:
            for
              _ <- tourRepo.setNotified(rt)
              subscribers <- tourRepo.subscribers(rt.tour.id)
              _ <- subscribers.nonEmpty.so:
                notifyApi.notifyMany(
                  subscribers,
                  NotificationContent.BroadcastRound(
                    rt.path,
                    rt.tour.name.value,
                    s"${rt.round.name} has begun"
                  )
                )
            yield ()

  def onCreate(rt: RelayRound.WithTour, chapter: Chapter): Funit =
    (!rt.round.isFinished && lila.study.StudyPgnTags.points(chapter.tags).isEmpty).so:
      for
        _ <- notifyTournamentSubscribers(rt)
        _ <- (rt.tour.isPublic && rt.tour.official).so:
          Side.values.toList.traverse(notifyPlayerFollowers.ofSide(rt, chapter))
      yield ()

  def onUpdate = onCreate
