package views.user

import lila.app.UiEnv.{ *, given }
import lila.core.rank.RankTrackId
import lila.core.perf.UserWithPerfs
import lila.core.user.{ FlagCode, LightRank }

object list:

  private lazy val ui = lila.user.ui.UserList(helpers, bits)

  def apply(
      online: List[UserWithPerfs],
      leaderboards: List[(RankTrackId, List[LightRank], Option[lila.user.XiangqiPersonalRank])],
      flags: Map[UserId, FlagCode]
  )(using Context) =
    ui.page(online, leaderboards, flags)

  def bots(users: List[UserWithPerfs])(using Context) = ui.bots(users)
