package lila.app
package mashup

import play.api.data.FormBinding
import play.api.i18n.Lang
import play.api.mvc.Request
import scalalib.paginator.{ AdapterLike, Paginator }
import lila.db.dsl.{ *, given }
import lila.game.{ GameFilter, Query }
import lila.core.game.Game
import lila.core.user.User

enum GameHistoryEntry:
  case Duel(game: Game)
  case Kingdoms(game: lila.threeKingdoms.KingdomGame)
  def userIds: List[UserId] = this match
    case Duel(g) => g.userIds
    case Kingdoms(g) => g.userIds
  def tournamentId: Option[TourId] = this match
    case Duel(g) => g.tournamentId
    case Kingdoms(g) => g.tournamentId
  def swissId: Option[SwissId] = this match
    case Duel(g) => g.swissId
    case _ => None

/** A history projection, not a fabricated two-player game. Each store keeps its native rules aggregate; Mongo
  * merges only indexed IDs and dates before loading this page's records.
  */
final class GameHistory(
    native: GameFilterMenu.PaginatorBuilder,
    gameRepo: lila.game.GameRepo,
    kingdoms: lila.threeKingdoms.GameRepo,
    proxy: lila.round.GameProxyRepo,
    bookmarks: lila.bookmark.BookmarkApi
)(using Executor):
  import GameHistoryEntry.*
  private val combined = Set(
    GameFilter.all,
    GameFilter.threeKingdoms,
    GameFilter.ranked,
    GameFilter.win,
    GameFilter.loss,
    GameFilter.draw,
    GameFilter.playing,
    GameFilter.me
  )

  def apply(user: User, nbs: Option[UserInfo.NbGames], filter: GameFilter, page: Int)(using
      Request[?],
      FormBinding,
      Lang,
      Option[Me]
  ): Fu[Paginator[GameHistoryEntry]] =
    if filter == GameFilter.bookmark then
      Paginator(
        new AdapterLike[GameHistoryEntry]:
          def nbResults = bookmarks.countByUser(user)
          def slice(offset: Int, length: Int): Fu[Seq[GameHistoryEntry]] =
            bookmarks.coll
              .find(bookmarks.userIdQuery(user.id), Some($doc("g" -> true)))
              .sort($doc("d" -> -1, "_id" -> -1))
              .skip(offset)
              .cursor[Bdoc](ReadPref.sec)
              .list(length)
              .flatMap(docs => load(docs.flatMap(_.getAsOpt[GameId]("g"))))
        ,
        currentPage = page,
        maxPerPage = MaxPerPage(12)
      )
    else if !combined.contains(filter) then native(user, nbs, filter, page).map(_.mapResults(Duel(_)))
    else
      val other = summon[Option[Me]].map(_.userId).getOrElse(user.id)
      val kingdomQuery = kingdoms.historySelector(user.id, filter.name, Some(other))
      val nativeQuery = filter match
        case GameFilter.all => Query.started(user.id)
        case GameFilter.ranked => Query.ranked(user.id)
        case GameFilter.win => Query.win(user.id)
        case GameFilter.loss => Query.loss(user.id)
        case GameFilter.draw => Query.draw(user.id)
        case GameFilter.playing => Query.nowPlaying(user.id)
        case GameFilter.me => $doc("us" -> $doc("$all" -> List(user.id, other).distinct))
        case _ => $doc("_id" -> $doc("$exists" -> false))
      Paginator(
        new AdapterLike[GameHistoryEntry]:
          def nbResults =
            gameRepo.coll.countSel(nativeQuery).zip(kingdoms.coll.countSel(kingdomQuery)).map(_ + _)
          def slice(offset: Int, length: Int): Fu[Seq[GameHistoryEntry]] =
            gameRepo.coll
              .aggregateList(length, _.sec): framework =>
                import framework.*
                Match(nativeQuery) -> List(
                  Sort(Descending("ca"), Descending("_id")),
                  Limit(offset + length),
                  Project($doc("_id" -> true, "createdAt" -> "$ca", "kind" -> $doc("$literal" -> "duel"))),
                  PipelineOperator(
                    $doc(
                      "$unionWith" -> $doc(
                        "coll" -> kingdoms.coll.name,
                        "pipeline" -> $arr(
                          $doc("$match" -> kingdomQuery),
                          $doc("$sort" -> $doc("createdAt" -> -1, "_id" -> -1)),
                          $doc("$limit" -> (offset + length)),
                          $doc(
                            "$project" -> $doc(
                              "_id" -> true,
                              "createdAt" -> true,
                              "kind" -> $doc("$literal" -> "kingdoms")
                            )
                          )
                        )
                      )
                    )
                  ),
                  Sort(Descending("createdAt"), Descending("_id")),
                  Skip(offset),
                  Limit(length)
                )
              .flatMap: docs =>
                val refs = docs.flatMap(d =>
                  for id <- d.getAsOpt[GameId]("_id"); kind <- d.getAsOpt[String]("kind") yield id -> kind
                )
                for
                  duels <- gameRepo
                    .gamesFromSecondary(refs.collect { case (id, "duel") => id })
                    .flatMap(proxy.upgradeIfPresent)
                  triples <- kingdoms.byIds(refs.collect { case (id, "kingdoms") => id })
                yield
                  val byId: Map[GameId, GameHistoryEntry] =
                    duels.map(g => g.id -> Duel(g)).toMap ++ triples.map(g => g.id -> Kingdoms(g))
                  refs.flatMap((id, _) => byId.get(id))
        ,
        currentPage = page,
        maxPerPage = MaxPerPage(12)
      )

  private def load(ids: Seq[GameId]): Fu[Seq[GameHistoryEntry]] =
    for
      duels <- gameRepo.gamesFromSecondary(ids).flatMap(proxy.upgradeIfPresent)
      triples <- kingdoms.byIds(ids)
    yield
      val entries: Map[GameId, GameHistoryEntry] =
        duels.map(g => g.id -> Duel(g)).toMap ++ triples.map(g => g.id -> Kingdoms(g))
      ids.flatMap(entries.get)
