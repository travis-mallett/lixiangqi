package lila.playerDirectory

import com.softwaremill.macwire.*
import play.api.libs.ws.StandaloneWSClient
import lila.core.playerDirectory.PlayerId

import lila.core.config.CollName
import lila.core.playerDirectory.*
import lila.memo.{ CacheApi, PicfitApi, PicfitUrl }
import scalalib.paginator.Paginator

@Module
final class Env(
    db: lila.db.Db,
    appConfig: play.api.Configuration,
    cacheApi: CacheApi,
    picfitApi: PicfitApi,
    picfitUrl: PicfitUrl,
    ws: StandaloneWSClient
)(using
    Executor
)(using mode: play.api.Mode):

  private val catalog = DirectoryCatalog(ws, appConfig)
  val repo = DirectoryRepo(catalog, db(CollName("directory_player_follower")))

  lazy val json = wire[DirectoryJson]

  lazy val playerApi = wire[DirectoryPlayerApi]

  lazy val federationApi = wire[FederationApi]

  lazy val paginator = wire[DirectoryPaginator]

  def federationsOf: Federation.FedsOf = playerApi.federationsOf
  given Federation.GetName = federationApi.getName
  given Tokenize = DirectoryPlayer.tokenize
  def guessPlayer: GuessPlayer = playerApi.guessPlayer.apply
  given getPlayer: GetPlayer = playerApi.get
  def getPlayerFollowers: GetPlayerFollowers = repo.follower.followers
  def photosJson: PhotosJson.Get = ids => playerApi.photos(ids).map(json.photosJson)

  def search(q: Option[String], page: Int = 1, order: DirectoryPlayerOrder)(using
      me: Option[Me]
  ): Fu[Either[DirectoryPlayer.WithFollow, Paginator[DirectoryPlayer.WithFollow]]] =
    val query = q.so(_.trim)
    PlayerId
      .parse(query)
      .so(playerApi.fetch)
      .flatMap:
        case Some(player) =>
          me.so(repo.follower.isFollowing(_, player.id))
            .map(DirectoryPlayer.WithFollow(player, _))
            .map(Left(_))
        case None => paginator.ordered(page, query, order).map(Right(_))

  given Federation.Guess = lila.playerDirectory.Federation.find

  lila.common.Cli.handle:
    case "playerDirectory" :: "player" :: "rip" :: playerId :: year :: Nil =>
      PlayerId
        .parse(playerId)
        .so(repo.player.setDeceasedYear(_, year.toIntOption))
        .inject("done")
