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
    blocking: Blocking,
    jieqiRank: RankSnapshot = lila.rating.JieqiRank.initialSnapshot,
    miniXiangqiRank: RankSnapshot = lila.rating.MiniXiangqiRank.initialSnapshot,
    manchuRank: RankSnapshot = lila.rating.ManchuRank.initialSnapshot
):
  def rankFor(track: Option[RankTrackId]) = if track.contains(RankTrackId.jieqi) then jieqiRank
  else if track.contains(RankTrackId.minixiangqi) then miniXiangqiRank
  else if track.contains(RankTrackId.manchu) then manchuRank
  else rank

private[lobby] object LobbyUser:

  given UserIdOf[LobbyUser] = _.id

  def make(user: UserWithPerfs, blocking: Blocking) =
    LobbyUser(
      id = user.id,
      username = user.username,
      lame = user.lame,
      bot = user.isBot,
      rank = XiangqiRank.snapshot(user.perfs.rank(RankTrackId.xiangqi).getOrElse(XiangqiRank.initial)),
      blocking = blocking,
      jieqiRank = lila.rating.JieqiRank.snapshot(
        user.perfs.rank(RankTrackId.jieqi).getOrElse(lila.rating.JieqiRank.initial)
      ),
      miniXiangqiRank = lila.rating.MiniXiangqiRank.snapshot(
        user.perfs.rank(RankTrackId.minixiangqi).getOrElse(lila.rating.MiniXiangqiRank.initial)
      ),
      manchuRank = lila.rating.ManchuRank.snapshot(
        user.perfs.rank(RankTrackId.manchu).getOrElse(lila.rating.ManchuRank.initial)
      )
    )
