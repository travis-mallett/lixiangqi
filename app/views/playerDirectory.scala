package views.playerDirectory

import scalalib.paginator.Paginator

import lila.app.UiEnv.*
import lila.playerDirectory.{ DirectoryPlayer, DirectoryRatingHistory }
import lila.relay.RelayTour

private def broadcastOrPlayerMenu(helpers: lila.ui.Helpers): String => lila.ui.Context ?=> Frag = active =>
  ctx ?=>
    import helpers.given
    if ctx.req.queryString.contains("community") then views.user.bits.communityMenu("players")
    else views.relay.menu(active)

lazy val ui = lila.playerDirectory.ui.PlayerDirectoryUi(helpers)(broadcastOrPlayerMenu(helpers))
lazy val playerUi = lila.playerDirectory.ui.DirectoryPlayerUi(helpers, ui, picfitUrl)
export ui.federation

object player:
  export playerUi.{ index, notFound }

  def show(
      player: DirectoryPlayer,
      user: Option[User],
      tours: Paginator[RelayTour.WithLastRound],
      ratings: DirectoryRatingHistory,
      isFollowing: Boolean
  )(using Context) =
    playerUi.show(
      player,
      user,
      (tours.nbResults > 0).option:
        views.relay.tour.renderPager(views.relay.tour.asRelayPager(tours)):
          routes.PlayerDirectory.show(player.id, player.slug, _)
      ,
      ratings,
      isFollowing
    )
