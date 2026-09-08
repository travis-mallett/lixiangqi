package lila.lobby

import lila.core.perf.UserWithPerfs
import lila.core.pool.Blocking
import lila.core.rank.RankSnapshot
import lila.core.rank.RankTrackId
import lila.rating.XiangqiRank

private[lobby] case class LobbyUser(
    id: UserId,
    username: UserName,
    lame: Boolean,
    bot: Boolean,
    rank: RankSnapshot,
    blocking: Blocking
)

private[lobby] object LobbyUser:

  given UserIdOf[LobbyUser] = _.id

  def make(user: UserWithPerfs, blocking: Blocking) =
    LobbyUser(
      id = user.id,
      username = user.username,
      lame = user.lame,
      bot = user.isBot,
      rank = XiangqiRank.snapshot(user.perfs.rank(RankTrackId.xiangqi).getOrElse(XiangqiRank.initial)),
      blocking = blocking
    )
