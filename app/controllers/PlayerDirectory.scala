package controllers

import play.api.mvc.*

import lila.app.{ *, given }
import lila.core.playerDirectory.DirectoryPlayerOrder
import lila.playerDirectory.{ DirectoryPlayer, Federation }

final class PlayerDirectory(env: Env) extends LilaController(env):

  import env.playerDirectory.json.given
  private def playerUrl(player: DirectoryPlayer) = routes.PlayerDirectory.show(player.id, player.slug)

  def index(page: Int, q: Option[String] = None) = Open:
    Reasonable(page):
      val order = get("order").flatMap(DirectoryPlayerOrder.byKey.get) | DirectoryPlayerOrder.default
      env.playerDirectory
        .search(q, page, order)
        .flatMap:
          case Left(p) => Redirect(playerUrl(p.player))
          case Right(pager) =>
            renderPage(views.playerDirectory.player.index(pager, q.so(_.trim), order)).map(Ok(_))

  def show(id: lila.core.playerDirectory.PlayerId, slug: String, page: Int) = Open:
    WithProxy:
      limit.enumeration.directoryPlayer(rateLimited):
        env.playerDirectory.repo.player
          .fetch(id)
          .flatMap:
            case None => NotFound.page(views.playerDirectory.player.notFound(id))
            case Some(player) =>
              if player.slug != slug then Redirect(playerUrl(player))
              else
                for
                  user <- env.title.api.publicUserOf(player.id)
                  tours <- env.relay.playerTour.playerTours(player, page)
                  isFollowing <- ctx.userId.so(env.playerDirectory.repo.follower.isFollowing(_, id))
                  ratings <- env.playerDirectory.repo.rating.get(player.id)
                  rendered <- renderPage(
                    views.playerDirectory.player.show(player, user, tours, ratings, isFollowing)
                  )
                yield Ok(rendered)

  def follow(playerId: lila.core.playerDirectory.PlayerId, follow: Boolean) = AuthOrScopedBody(_.Web.Mobile):
    _ ?=>
      me ?=>
        val f = if follow then env.playerDirectory.repo.follower.follow
        else env.playerDirectory.repo.follower.unfollow
        for _ <- f(me.userId, playerId) yield NoContent

  def apiShow(id: lila.core.playerDirectory.PlayerId) = Anon:
    WithProxy:
      limit.enumeration.directoryPlayer(rateLimited):
        Found(env.playerDirectory.playerApi.withFollow(id))(JsonOk)

  def apiRatings(id: lila.core.playerDirectory.PlayerId) = Anon:
    WithProxy:
      limit.enumeration.directoryPlayer(rateLimited):
        JsonOk(env.playerDirectory.playerApi.getRatings(id).map(_.toJson))

  def apiSearch(q: String) = Anon:
    env.playerDirectory
      .search(q.some, 1, DirectoryPlayerOrder.default)
      .map(_.fold(Seq(_), _.currentPageResults))
      .map(JsonOk)

  def federations(page: Int) = Open:
    for
      feds <- env.playerDirectory.paginator.federations(page)
      renderedPage <- renderPage(views.playerDirectory.federation.index(feds))
    yield Ok(renderedPage)

  def federation(slug: String, page: Int) = Open:
    Found(env.playerDirectory.federationApi.find(slug)): fed =>
      val fedSlug = Federation.nameToSlug(fed.name)
      if slug != fedSlug then Redirect(routes.PlayerDirectory.federation(fedSlug))
      else
        for
          players <- env.playerDirectory.paginator.federationPlayers(fed, page)
          playersList = views.playerDirectory.playerUi.playerList(
            players,
            DirectoryPlayerOrder.default,
            routes.PlayerDirectory.federation(fed.slug, _),
            sortable = false
          )
          rendered <- renderPage(views.playerDirectory.federation.show(fed, playersList))
        yield Ok(rendered)

  def playerPhoto(id: lila.core.playerDirectory.PlayerId) =
    SecureBody(lila.web.HashedMultiPart(parse))(_.DirectoryPlayer) { ctx ?=> _ ?=>
      Found(env.playerDirectory.repo.player.fetch(id)): p =>
        ctx.body.body.file("photo") match
          case Some(photo) =>
            for
              pic <- env.playerDirectory.playerApi.uploadPhoto(p, photo)
              picUrl = DirectoryPlayer.PlayerPhoto(env.memo.picfitUrl, pic.id, _.Small)
              _ <- env.irc.api.directoryPhoto(playerUrl(p).url, picUrl)
            yield Redirect(routes.Coach.edit)
          case None => Redirect(playerUrl(p))
    }

  def playerUpdate(id: lila.core.playerDirectory.PlayerId) = SecureBody(_.DirectoryPlayer) { ctx ?=> _ ?=>
    Found(env.playerDirectory.repo.player.fetch(id)): p =>
      bindForm(DirectoryPlayer.form.credit(p))(
        _ => funit,
        credit =>
          for
            _ <- env.playerDirectory.playerApi.setPhotoCredit(p, credit)
            _ <- env.irc.api.directoryPhotoCredits(playerUrl(p).url, credit | "-")
          yield ()
      ).inject(Redirect(playerUrl(p)))
  }
