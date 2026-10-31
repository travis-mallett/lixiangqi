package lila.playerDirectory

import chess.PlayerName
import lila.xiangqi.Xiangqi.BySide
import lila.core.playerDirectory.PlayerTitle
import lila.core.playerDirectory.PlayerId

import lila.core.playerDirectory.Federation
import lila.memo.{ CacheApi, PicfitApi }
import lila.memo.PicfitImage
import lila.memo.CacheApi.invalidate

final class DirectoryPlayerApi(repo: DirectoryRepo, cacheApi: CacheApi, picfitApi: PicfitApi)(using Executor):

  export repo.player.fetch
  export repo.rating.get as getRatings

  def players(ids: BySide[Option[PlayerId]]): Fu[BySide[Option[DirectoryPlayer]]] =
    ids.traverse:
      _.so(idToPlayerCache.get)

  def federationsOf(ids: List[PlayerId]): Fu[Federation.ByPlayerIds] = ids.nonEmpty.so:
    idToPlayerCache
      .getAll(ids)
      .map:
        _.view
          .mapValues(_.flatMap(_.fed))
          .collect:
            case (k, Some(v)) => k -> v
          .toMap

  def withFollow(id: PlayerId)(using me: Option[Me]): Fu[Option[DirectoryPlayer.WithFollow]] =
    idToPlayerCache
      .get(id)
      .flatMapz: player =>
        me.map(_.userId)
          .so(repo.follower.isFollowing(_, id))
          .map(DirectoryPlayer.WithFollow(player, _).some)

  def uploadPhoto(p: DirectoryPlayer, photo: PicfitApi.FilePart)(using me: Me): Fu[PicfitImage] =
    for
      pic <- picfitApi.uploadFile(photo, me.userId, s"directoryPlayer:${p.id}".some, requestAutomod = false)
      _ <- repo.player.setPhoto(p.id, DirectoryPlayer.PlayerPhoto(pic.id, none))
    yield
      idToPlayerCache.invalidate(p.id)
      pic

  def edit(p: DirectoryPlayer, language: String, edit: DirectoryPlayer.form.Edit): Funit =
    repo.player.edit(p, language, edit).map(_ => idToPlayerCache.invalidate(p.id))

  private val idToPlayerCache =
    cacheApi[PlayerId, Option[DirectoryPlayer]](8_192, "player.directoryPlayer.byId"):
      _.expireAfterWrite(3.minutes).buildAsyncFuture(repo.player.fetch)

  export idToPlayerCache.get

  def photos(ids: Set[PlayerId]): Fu[Map[PlayerId, DirectoryPlayer.PlayerPhoto]] =
    ids.toList
      .traverse(get)
      .map:
        _.flatten.flatMap: p =>
          p.photo.map(p.id -> _)
      .map(_.toMap)

  object guessPlayer:

    private case class TitleName(title: Option[PlayerTitle], name: PlayerName)

    def apply(
        playerId: Option[PlayerId],
        name: Option[PlayerName],
        title: Option[PlayerTitle]
    ): Fu[Option[DirectoryPlayer]] = playerId match
      case Some(playerId) => idToPlayerCache.get(playerId)
      case None => name.map(TitleName(title, _)).so(cache.get)

    private val cache =
      cacheApi[TitleName, Option[DirectoryPlayer]](1024, "player.directoryPlayer.byName"):
        _.expireAfterWrite(5.minutes).buildAsyncFuture: p =>
          repo.player
            .resolve(p.name.value)
            .map(
              _.filter(player =>
                p.title.forall(t => player.titles.exists(a => a.code == t.value && a.status == "recorded"))
              )
            )
