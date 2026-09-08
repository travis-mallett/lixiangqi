package views.user

import lila.app.UiEnv.*
import lila.core.perf.UserWithPerfs
import lila.core.user.LightRank

object list:

  private lazy val ui = lila.user.ui.UserList(helpers, bits)

  def apply(online: List[UserWithPerfs], leaderboard: List[LightRank])(using Context) =
    ui.page(online, leaderboard)

  def bots(users: List[UserWithPerfs])(using Context) = ui.bots(users)
