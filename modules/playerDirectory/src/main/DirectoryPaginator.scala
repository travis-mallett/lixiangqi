package lila.playerDirectory

import scalalib.paginator.{ AdapterLike, Paginator }
import play.api.libs.json.*
import lila.core.playerDirectory.DirectoryPlayerOrder

final class DirectoryPaginator(repo: DirectoryRepo)(using Executor):
  val maxPerPage = MaxPerPage(30)

  def federations(page: Int): Fu[Paginator[Federation]] = repo.federation.all.flatMap: rows =>
    Paginator(
      new AdapterLike[Federation]:
        def nbResults = fuccess(rows.size)
        def slice(offset: Int, length: Int) = fuccess(rows.slice(offset, offset + length))
      ,
      page,
      maxPerPage
    )

  def federationPlayers(fed: Federation, page: Int)(using
      Option[Me]
  ): Fu[Paginator[DirectoryPlayer.WithFollow]] =
    listed(page, Json.obj("federation" -> fed.id.value))

  def ordered(page: Int, query: String, order: DirectoryPlayerOrder)(using
      me: Option[Me]
  ): Fu[Paginator[DirectoryPlayer.WithFollow]] =
    val base = Json.obj(
      "search" -> query,
      "order" -> (if order == DirectoryPlayerOrder.follow then "name" else order.key)
    )
    if order == DirectoryPlayerOrder.follow then
      me.fold(listed(page, base ++ Json.obj("ids" -> List.empty[String]))): me =>
        repo.follower
          .followedIds(me.userId)
          .flatMap(ids => listed(page, base ++ Json.obj("ids" -> ids.map(_.value))))
    else listed(page, base)

  private def listed(page: Int, query: JsObject)(using
      me: Option[Me]
  ): Fu[Paginator[DirectoryPlayer.WithFollow]] =
    repo
      .list(query ++ Json.obj("page" -> page, "pageSize" -> maxPerPage.value))
      .flatMap: (total, rows) =>
        Paginator(
          new AdapterLike[DirectoryPlayer]:
            def nbResults = fuccess(total)
            def slice(offset: Int, length: Int) = fuccess(rows)
          ,
          page,
          maxPerPage
        ).flatMap: pager =>
          pager.mapFutureList: players =>
            me.fold(fuccess(players.map(DirectoryPlayer.WithFollow(_, false)))): me =>
              repo.follower.withFollows(players, me.userId)
