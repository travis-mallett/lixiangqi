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
    cacheApi: CacheApi,
    picfitApi: PicfitApi,
    picfitUrl: PicfitUrl,
    ws: StandaloneWSClient,
    httpProxy: lila.memo.HttpProxy
)(using
    Executor,
    org.apache.pekko.stream.Materializer
)(using mode: play.api.Mode, scheduler: Scheduler):

  val repo =
    DirectoryRepo(
      playerColl = db(CollName("directory_player")),
      ratingColl = db(CollName("directory_player_rating")),
      federationColl = db(CollName("directory_federation")),
      followerColl = db(CollName("directory_player_follower"))
    )

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

  private lazy val directorySync = wire[DirectoryPlayerSync]

  scheduler.scheduleOnce(5.seconds):
    repo.player.countAll.flatMap(count => if count == 0 then directorySync() else funit).logFailure(logger)

  if mode.isProd then
    scheduler.scheduleWithFixedDelay(1.hour, 1.hour): () =>
      if nowDateTime.getHour == 4
      then directorySync()

  lila.common.Cli.handle:
    case "playerDirectory" :: "player" :: "sync" :: Nil =>
      directorySync()
      fuccess("Updating the player database in the background.")
    case "playerDirectory" :: "player" :: "delete" :: id :: Nil =>
      PlayerId.parse(id).so(playerApi.delete).inject("done")
    case "playerDirectory" :: "player" :: "rip" :: playerId :: year :: Nil =>
      PlayerId
        .parse(playerId)
        .so(repo.player.setDeceasedYear(_, year.toIntOption))
        .inject("done")
