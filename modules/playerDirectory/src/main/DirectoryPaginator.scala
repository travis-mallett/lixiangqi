package lila.playerDirectory

import reactivemongo.api.*
import scalalib.paginator.{ AdapterLike, Paginator }

import lila.db.dsl.{ *, given }
import lila.db.paginator.{ Adapter, CachedAdapter }
import lila.core.playerDirectory.DirectoryPlayerOrder

final class DirectoryPaginator(repo: DirectoryRepo)(using Executor):

  import repo.player.given
  import repo.federation.given

  val maxPerPage = MaxPerPage(30)

  def federations(page: Int): Fu[Paginator[Federation]] =
    Paginator(
      adapter = new AdapterLike[Federation]:
        def nbResults: Fu[Int] = fuccess(Federation.names.size)
        def slice(offset: Int, length: Int) =
          repo.federationColl
            .find($empty)
            .sort($sort.desc("standard.top10Rating"))
            .skip(offset)
            .cursor[lila.playerDirectory.Federation]()
            .list(length)
      ,
      currentPage = page,
      maxPerPage = maxPerPage
    )

  def federationPlayers(fed: Federation, page: Int)(using
      Option[Me]
  ): Fu[Paginator[DirectoryPlayer.WithFollow]] =
    Paginator(
      adapter = new AdapterLike[DirectoryPlayer]:
        def nbResults: Fu[Int] = fuccess(100 * maxPerPage.value)
        def slice(offset: Int, length: Int) =
          repo.playerColl
            .find(repo.player.selectActive ++ repo.player.selectFed(fed.id))
            .sort(repo.player.sortStandard)
            .skip(offset)
            .cursor[DirectoryPlayer](ReadPref.sec)
            .list(length)
      ,
      currentPage = page,
      maxPerPage = maxPerPage
    ).flatMap(addFollows)

  def ordered(page: Int, query: String, order: DirectoryPlayerOrder)(using
      me: Option[Me]
  ): Fu[Paginator[DirectoryPlayer.WithFollow]] =
    val search = DirectoryPlayer.tokenize.exec(query).some.filter(_.size > 1)
    Paginator(
      adapter = search match
        case Some(search) =>
          val textScore = $doc("score" -> $doc("$meta" -> "textScore"))
          Adapter[DirectoryPlayer](
            collection = repo.playerColl,
            selector = $text(search),
            projection = textScore.some,
            sort = textScore ++ repo.player.sortStandard, // don't touch, hits FTS index with standard
            _.sec
          )
        case _ =>
          val plentyOfResults = fuccess(100 * maxPerPage.value)
          me match
            case Some(me) if order == DirectoryPlayerOrder.follow =>
              new AdapterLike[DirectoryPlayer]:
                def nbResults: Fu[Int] = plentyOfResults
                def slice(offset: Int, length: Int): Fu[Seq[DirectoryPlayer]] =
                  repo.followerColl
                    .aggregateList(length, _.sec): framework =>
                      import framework.*
                      Match($doc("u" -> me.userId)) -> List(
                        Project($doc("_id" -> false, "p" -> true)),
                        PipelineOperator:
                          $lookup.simple(from = repo.playerColl, as = "player", local = "p", foreign = "_id")
                        ,
                        Unwind("player"),
                        ReplaceRootField("player"),
                        Sort(Descending(DirectoryPlayerOrder.default.key)),
                        Skip(offset),
                        Limit(length)
                      )
                    .map:
                      _.flatMap(repo.player.handler.readOpt)
            case _ =>
              CachedAdapter(
                Adapter[DirectoryPlayer](
                  collection = repo.playerColl,
                  selector = repo.player.selectActive,
                  projection = none,
                  sort = repo.player.sortBy(order),
                  _.sec
                ),
                plentyOfResults
              )
      ,
      currentPage = page,
      maxPerPage = maxPerPage
    ).flatMap(addFollows)

  private def addFollows(
      pager: Paginator[DirectoryPlayer]
  )(using me: Option[Me]): Fu[Paginator[DirectoryPlayer.WithFollow]] =
    pager.mapFutureList: players =>
      me.fold(fuccess(players.map(DirectoryPlayer.WithFollow(_, false)))): me =>
        repo.follower.withFollows(players, me.userId)
