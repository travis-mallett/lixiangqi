package views.user

import lila.app.UiEnv.{ *, given }
import lila.core.rank.RankTrackId
import lila.core.perf.UserWithPerfs
import lila.core.user.LightRank

object list:

  private lazy val ui = lila.user.ui.UserList(helpers, bits)

  def apply(
      online: List[UserWithPerfs],
      leaderboards: List[(RankTrackId, List[LightRank], Option[lila.user.XiangqiPersonalRank])]
  )(using Context) =
    ui.page(online, leaderboards)

  def bots(users: List[UserWithPerfs])(using Context) = ui.bots(users)
