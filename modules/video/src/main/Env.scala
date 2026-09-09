package lila.video

import com.softwaremill.macwire.*
import play.api.Configuration
import play.api.libs.ws.StandaloneWSClient

import lila.common.autoconfig.{ *, given }
import lila.common.config.given
import lila.core.config.*

@Module
private final class VideoConfig(
    @ConfigName("collection.video") val videoColl: CollName,
    @ConfigName("collection.view") val viewColl: CollName,
    @ConfigName("collection.tag") val tagColl: CollName,
    @ConfigName("youtube.url") val youtubeUrl: String,
    @ConfigName("youtube.api_key") val youtubeApiKey: Secret,
    @ConfigName("metadata.refresh_max") val metadataRefreshMax: Max,
    @ConfigName("bilibili.url") val bilibiliUrl: String
)

final class Env(
    appConfig: Configuration,
    ws: StandaloneWSClient,
    scheduler: Scheduler,
    db: lila.db.Db,
    cacheApi: lila.memo.CacheApi,
    mode: play.api.Mode
)(using Executor, Scheduler):

  private val config = appConfig.get[VideoConfig]("video")(using AutoConfig.loader)

  lazy val api = VideoApi(
    cacheApi = cacheApi,
    videoColl = db(config.videoColl),
    viewColl = db(config.viewColl),
    tagColl = db(config.tagColl)
  )

  private lazy val youtube = YoutubeProvider(
    ws = ws,
    apiUrl = config.youtubeUrl,
    apiKey = config.youtubeApiKey
  )

  private lazy val bilibili = BilibiliProvider(ws, config.bilibiliUrl)

  private lazy val providers = VideoProviderRegistry(youtube, bilibili)

  lazy val adminApi = VideoAdminApi(api, providers)

  if mode.isProd then
    scheduler.scheduleWithFixedDelay(10.minutes, 1.day): () =>
      adminApi.refreshStale(config.metadataRefreshMax.value).logFailure(logger)
