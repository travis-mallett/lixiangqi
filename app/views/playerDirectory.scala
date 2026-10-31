package views.playerDirectory

import lila.app.UiEnv.*

private def broadcastOrPlayerMenu(helpers: lila.ui.Helpers): String => lila.ui.Context ?=> Frag = active =>
  ctx ?=>
    import helpers.given
    if active == "players" then views.user.bits.communityMenu("players")
    else views.relay.menu(active)

lazy val ui: lila.playerDirectory.ui.PlayerDirectoryUi =
  lila.playerDirectory.ui.PlayerDirectoryUi(helpers)(broadcastOrPlayerMenu(helpers))
lazy val playerUi: lila.playerDirectory.ui.DirectoryPlayerUi =
  lila.playerDirectory.ui.DirectoryPlayerUi(helpers, ui, picfitUrl)
export ui.federation

object player:
  export playerUi.{ index, notFound }

  export playerUi.profile
