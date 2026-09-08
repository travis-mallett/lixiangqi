package lila.video

trait ExternalVideoProvider:
  def provider: VideoProvider
  def parse(input: String): Option[VideoSource]
  def fetch(externalId: String): Fu[Either[String, VideoMetadata]]
  def fetchMany(externalIds: List[String]): Fu[Map[String, Either[String, VideoMetadata]]]

final class VideoProviderRegistry(youtube: YoutubeProvider, bilibili: BilibiliProvider)(using Executor):

  private val providers: List[ExternalVideoProvider] = List(youtube, bilibili)

  def parse(input: String): Either[String, VideoSource] =
    providers
      .flatMap(_.parse(input.trim))
      .headOption
      .toRight("Use a valid YouTube or Bilibili video URL.")

  def fetch(source: VideoSource): Fu[Either[String, VideoMetadata]] =
    providers
      .find(_.provider == source.provider)
      .fold(fuccess(Left(s"Unsupported video provider: ${source.provider.label}")))(
        _.fetch(source.externalId)
      )

  def fetchMany(videos: List[Video]): Fu[List[(Video, VideoMetadata)]] =
    videos
      .groupBy(_.source.provider)
      .toList
      .sequentially: (provider, grouped) =>
        providers
          .find(_.provider == provider)
          .fold(fuccess(List.empty[(Video, VideoMetadata)])): service =>
            service
              .fetchMany(grouped.map(_.source.externalId))
              .map: results =>
                grouped.map: video =>
                  val metadata = results
                    .get(video.source.externalId)
                    .fold(video.metadata.failed("The provider returned no metadata.")):
                      _.fold(video.metadata.failed, identity)
                  video -> metadata
      .map(_.flatten)
