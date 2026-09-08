package lila.user

import lila.core.perf.UserWithPerfs
import lila.core.user.LightRank
import lila.core.userId.UserSearch
import lila.db.dsl.*
import lila.memo.CacheApi.*
import lila.rating.UserPerfsExt.*
import lila.mon.extensions.*

final class Cached(
    userRepo: UserRepo,
    userApi: UserApi,
    onlineUserIds: lila.core.socket.OnlineIds,
    cacheApi: lila.memo.CacheApi,
    xiangqiRankingApi: XiangqiRankingApi
)(using Executor, Scheduler)
    extends lila.core.user.CachedApi:

  val top10Ranks = cacheApi.unit[List[LightRank]]("user.top10Ranks"):
    _.refreshAfterWrite(2.minutes).buildAsyncTimeout(2.minutes): _ =>
      xiangqiRankingApi.top(10).monSuccess(lila.mon.user.leaderboardCompute)

  def nbRegistered: Fu[Long] = nbRegisteredCache.getUnit

  private val nbRegisteredCache = cacheApi.unit[Long]("user.nbRegistered"):
    _.refreshAfterWrite(5.minutes).buildAsyncFuture(_ => userRepo.countAll)

  private val top50OnlineCache = cacheApi.unit[List[UserWithPerfs]]("user.top50Online"):
    _.refreshAfterWrite(2.minute).buildAsyncTimeout(): _ =>
      userApi
        .listWithPerfs(onlineUserIds.exec().take(512).toList, includeClosed = false)
        .map:
          _.filter(_.noBot)
            .sortBy(_.perfs.xiangqiRank.fold(Int.MinValue)(_.score.value))(using Ordering.Int.reverse)
            .take(50)

  def getTop50Online: Fu[List[UserWithPerfs]] = top50OnlineCache.getUnit

  private val botIds = cacheApi.unit[Set[UserId]]("user.botIds"):
    _.refreshAfterWrite(5.minutes).buildAsyncTimeout()(_ => userRepo.botIds)

  def getBotIds: Fu[Set[UserId]] = botIds.getUnit

  private def userIdsLikeFetch(text: UserSearch) =
    userRepo.userIdsLikeFilter(text, $empty, 12)

  private val userIdsLikeCache = cacheApi[UserSearch, List[UserId]](1024, "user.like"):
    _.expireAfterWrite(5.minutes).buildAsyncTimeout()(userIdsLikeFetch)

  def userIdsLike(text: UserSearch): Fu[List[UserId]] =
    if text.value.lengthIs < 5 then userIdsLikeCache.get(text)
    else userIdsLikeFetch(text)
