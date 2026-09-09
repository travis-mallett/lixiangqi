package lila.user

import reactivemongo.api.bson.*

import lila.core.rank.RankTrackId
import lila.core.rank.RankTrackId.*
import lila.core.user.LightRank
import lila.db.dsl.{ *, given }
import lila.rating.{ UserPerfs, XiangqiRank }

enum XiangqiPersonalRank:
  case Ranked(place: Int, entry: LightRank)
  case Unplayed
  case Ineligible

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

  /** The displayed slice together with the exact place of a ranked user. Uses displayed position when
    * available; otherwise counts higher eligible accounts with the same ordering as top.
    */
  def personal(user: User, displayed: List[LightRank]): Fu[XiangqiPersonalRank] =
    if !user.rankable then fuccess(XiangqiPersonalRank.Ineligible)
    else
      displayed.zipWithIndex.find(_._1.user.id == user.id) match
        case Some((entry, index)) => fuccess(XiangqiPersonalRank.Ranked(index + 1, entry))
        case None =>
          perfsRepo
            .byId(user)
            .flatMap: perfs =>
              perfs.rank(RankTrackId.xiangqi).filter(_.games > 0) match
                case None => fuccess(XiangqiPersonalRank.Unplayed)
                case Some(perf) => personalByCount(user, perf)

  private def personalByCount(user: User, perf: lila.core.rank.RankPerf): Fu[XiangqiPersonalRank] =
    val s = "ranks.xiangqi.s"
    val la = "ranks.xiangqi.la"
    val newer = perf.latest.fold($doc(la -> $doc("$ne" -> reactivemongo.api.bson.BSONNull)))(date =>
      $doc(la -> $doc("$gt" -> date))
    )
    val equal = perf.latest.fold($doc(la -> reactivemongo.api.bson.BSONNull))(date => $doc(la -> date))
    val higher = $doc(
      "ranks.xiangqi.nb" -> $doc("$gt" -> 0),
      "$or" -> List(
        $doc(s -> $doc("$gt" -> perf.score.value)),
        $doc(s -> perf.score.value) ++ newer,
        $doc(s -> perf.score.value) ++ equal ++ $doc("_id" -> $doc("$lt" -> user.id))
      )
    )
    val eligible = userRepo.enabledNoBotSelect ++ userRepo.markSelect(lila.core.user.UserMark.rankban)(false)
    perfsRepo.coll
      .aggregateOne(_.sec): framework =>
        import framework.*
        Match(higher) -> List(
          PipelineOperator(
            userRepo.withColl(c =>
              $lookup.simple(
                c,
                "u",
                "_id",
                "_id",
                List($doc("$match" -> eligible), $doc("$project" -> $doc("_id" -> 1)))
              )
            )
          ),
          UnwindField("u"),
          PipelineOperator($doc("$count" -> "n"))
        )
      .map: doc =>
        XiangqiPersonalRank.Ranked(
          doc.flatMap(_.getAsOpt[Int]("n")).getOrElse(0) + 1,
          LightRank(
            user.light,
            RankTrackId.xiangqi,
            perf.score,
            XiangqiRank.catalog.code(perf.score),
            perf.progress
          )
        )
