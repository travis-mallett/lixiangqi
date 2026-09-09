package lila.video

final class VideoAdminApi(api: VideoApi, providers: VideoProviderRegistry)(using Executor):

  case class Preview(source: VideoSource, metadata: VideoMetadata)

  def saveTag(name: Tag, description: String, ids: List[Video.ID]): Fu[Either[String, Unit]] =
    api.tag
      .find(name)
      .zip(api.video.publishedForReorder)
      .flatMap:
        case (None, _) => fuccess(Left("This tag no longer has published videos."))
        case (Some(tag), videos) =>
          val expected = videos.filter(_.tags.contains(name)).map(_.id).toSet
          if description.length > 2000 then fuccess(Left("Tag descriptions must be at most 2000 characters."))
          else if ids.distinct.size != ids.size || ids.toSet != expected then
            fuccess(Left("The video list changed. Reload the page and try again."))
          else api.tag.save(tag.copy(description = description.trim, videoIds = ids)).inject(Right(()))

  def reorderTags(names: List[Tag]): Fu[Either[String, Unit]] =
    api.tag.all.flatMap: tags =>
      if names.distinct.size != names.size || names.toSet != tags.map(_.name).toSet then
        fuccess(Left("The tag list changed. Reload the page and try again."))
      else
        val byName = tags.map(t => t.name -> t).toMap
        names.zipWithIndex
          .sequentiallyVoid((name, index) => api.tag.setOrder(byName(name), index))
          .inject(Right(()))

  def preview(url: String): Fu[Either[String, Preview]] =
    providers.parse(url) match
      case Left(error) => fuccess(Left(error))
      case Right(source) =>
        providers
          .fetch(source)
          .map:
            _.map(Preview(source, _))

  def create(data: VideoForm.Data)(using MyId): Fu[Either[String, Video]] =
    providers.parse(data.sourceUrl) match
      case Left(error) => fuccess(Left(error))
      case Right(source) =>
        api.video
          .sourceExists(source)
          .flatMap:
            case true => fuccess(Left("That external video is already in the library."))
            case false =>
              for
                fetched <- providers.fetch(source)
                sortOrder <- api.video.nextSortOrder
                metadata = fetched.fold(VideoMetadata.empty.failed, identity)
                video = data.make(source, metadata, sortOrder)
                _ <- api.video.insert(video)
              yield Right(video)

  def update(video: Video, data: VideoForm.Data)(using MyId): Fu[Either[String, Video]] =
    providers.parse(data.sourceUrl) match
      case Left(error) => fuccess(Left(error))
      case Right(source) =>
        api.video
          .sourceExists(source, video.id.some)
          .flatMap:
            case true => fuccess(Left("That external video is already in the library."))
            case false =>
              val metadataFu =
                if source == video.source then fuccess(video.metadata)
                else providers.fetch(source).map(_.fold(VideoMetadata.empty.failed, identity))
              for
                metadata <- metadataFu
                updated = data.update(video, source, metadata)
                _ <- api.video.update(updated)
              yield Right(updated)

  def changeStatus(video: Video, status: VideoStatus)(using MyId): Funit =
    api.video.setStatus(video, status)

  def refresh(video: Video): Fu[Either[String, VideoMetadata]] =
    providers
      .fetch(video.source)
      .flatMap:
        case result @ Right(metadata) => api.video.setMetadata(video, metadata).inject(result)
        case Left(error) =>
          val failed = video.metadata.failed(error)
          api.video.setMetadata(video, failed).inject(Left(error))

  def refreshStale(limit: Int): Funit =
    for
      videos <- api.video.stale(limit)
      refreshed <- providers.fetchMany(videos)
      _ <- refreshed.sequentiallyVoid: (video, metadata) =>
        api.video.setMetadata(video, metadata).recover { case error =>
          logger.warn(s"metadata update ${video.id}", error)
        }
    yield ()

  def reorder(ids: List[Video.ID])(using MyId): Fu[Either[String, Unit]] =
    api.video.publishedForReorder.flatMap: published =>
      val expected = published.map(_.id)
      if ids.distinct.size != ids.size || ids.toSet != expected.toSet then
        fuccess(Left("The video list changed. Reload the page and try again."))
      else api.video.reorder(ids).inject(Right(()))
