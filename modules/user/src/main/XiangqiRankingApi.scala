package lila.user

import reactivemongo.api.bson.*

import lila.core.rank.RankTrackId
import lila.core.rank.RankTrackId.*
import lila.core.user.LightRank
import lila.db.dsl.{ *, given }
import lila.rating.{ UserPerfs, XiangqiRank }

/** Leaderboards are a projection of the authoritative native rank accounts in user_perf. */
final class XiangqiRankingApi(perfsRepo: UserPerfsRepo, userRepo: UserRepo)(using Executor):

  import UserPerfs.rankPerfHandler

  def top(nb: Int): Fu[List[LightRank]] =
    if nb <= 0 then fuccess(Nil)
    else
      val track = RankTrackId.xiangqi
      val batchSize = (nb * 3).max(100)

      def loop(skip: Int, found: List[LightRank]): Fu[List[LightRank]] =
        perfsRepo.coll
          .find(
            $doc(s"ranks.${track.value}.nb" -> $doc("$gt" -> 0)),
            $doc("_id" -> true, s"ranks.${track.value}" -> true).some
          )
          .sort($doc(s"ranks.${track.value}.s" -> -1, s"ranks.${track.value}.la" -> -1, "_id" -> 1))
          .skip(skip)
          .cursor[Bdoc](ReadPref.sec)
          .list(batchSize)
          .flatMap: docs =>
            val ranked = docs.flatMap: doc =>
              for
                id <- doc.getAsOpt[UserId]("_id")
                ranks <- doc.getAsOpt[Bdoc]("ranks")
                perf <- ranks.getAsOpt[lila.core.rank.RankPerf](track.value)
              yield id -> perf
            userRepo
              .byIdsSecondary(ranked.map(_._1))
              .flatMap: users =>
                val byId = users.filter(_.rankable).mapBy(_.id)
                val next = found ::: ranked.flatMap: (id, perf) =>
                  byId
                    .get(id)
                    .map: user =>
                      LightRank(
                        user = user.light,
                        track = track,
                        score = perf.score,
                        rank = XiangqiRank.catalog.code(perf.score),
                        progress = perf.progress
                      )
                if next.size >= nb || docs.size < batchSize then fuccess(next.take(nb))
                else loop(skip + docs.size, next)

      loop(skip = 0, found = Nil)
