package controllers

import play.api.data.Form
import play.api.data.Forms.*
import play.api.libs.json.Json

import lila.app.*
import lila.mod.Modlog
import lila.video.{ Video, VideoForm, VideoStatus }

final class VideoAdmin(env: Env) extends LilaController(env):

  private val api = env.video.api
  private val adminApi = env.video.adminApi
  private val reorderForm = Form(single("order" -> nonEmptyText(maxLength = 100_000)))

  def index(page: Int) = Secure(_.ManageVideos) { _ ?=> _ ?=>
    val status = get("status").flatMap(VideoStatus.byKey)
    val attention = getBool("attention")
    val query = get("q").map(_.trim).filter(_.nonEmpty)
    Ok.async:
      api.video
        .admin(status, attention, query, page)
        .map:
          views.videoAdmin.index(_, status, attention, query)
  }

  def form = Secure(_.ManageVideos) { _ ?=> _ ?=>
    Ok.async:
      api.tag.allPopular.map(views.videoAdmin.create(VideoForm.create, _))
  }

  def create = SecureBody(_.ManageVideos) { _ ?=> me ?=>
    bindForm(VideoForm.form)(
      invalid => BadRequest.async(api.tag.allPopular.map(views.videoAdmin.create(invalid, _))),
      data =>
        adminApi
          .create(data)
          .flatMap:
            case Left(error) =>
              val invalid = VideoForm.form.fill(data).withGlobalError(error)
              api.tag.allPopular.flatMap(tags => BadRequest.page(views.videoAdmin.create(invalid, tags)))
            case Right(video) =>
              env.mod.logApi
                .video(Modlog.videoCreate, video.id, video.title)
                .inject(Redirect(routes.Video.index).flashSuccess("Video added to the library."))
    )
  }

  def edit(id: Video.ID) = Secure(_.ManageVideos) { _ ?=> _ ?=>
    Found(api.video.find(id)): video =>
      Ok.async:
        api.tag.allPopular.map(views.videoAdmin.edit(video, VideoForm.edit(video), _))
  }

  def update(id: Video.ID) = SecureBody(_.ManageVideos) { _ ?=> me ?=>
    Found(api.video.find(id)): video =>
      bindForm(VideoForm.form)(
        invalid => BadRequest.async(api.tag.allPopular.map(views.videoAdmin.edit(video, invalid, _))),
        data =>
          adminApi
            .update(video, data)
            .flatMap:
              case Left(error) =>
                val invalid = VideoForm.form.fill(data).withGlobalError(error)
                api.tag.allPopular
                  .flatMap(tags => BadRequest.page(views.videoAdmin.edit(video, invalid, tags)))
              case Right(updated) =>
                env.mod.logApi
                  .video(Modlog.videoEdit, updated.id, updated.title)
                  .inject(Redirect(routes.VideoAdmin.edit(updated.id)).flashSuccess("Changes saved."))
      )
  }

  def status(id: Video.ID, key: String) = SecureBody(_.ManageVideos) { _ ?=> me ?=>
    VideoStatus
      .byKey(key)
      .fold(notFound): status =>
        Found(api.video.find(id)): video =>
          for
            _ <- adminApi.changeStatus(video, status)
            _ <- env.mod.logApi.video(Modlog.videoStatus, video.id, s"${video.title} -> ${status.label}")
          yield Redirect(routes.VideoAdmin.index()).flashSuccess(s"Video marked ${status.label.toLowerCase}.")
  }

  def preview = Secure(_.ManageVideos) { _ ?=> _ ?=>
    get("url")
      .filter(_.nonEmpty)
      .fold(BadRequest(Json.obj("error" -> "Enter a video URL.")).toFuccess): url =>
        adminApi
          .preview(url)
          .map:
            case Left(error) => UnprocessableEntity(Json.obj("error" -> error))
            case Right(preview) =>
              JsonOk(
                Json.obj(
                  "provider" -> preview.source.provider.label,
                  "canonicalUrl" -> preview.source.canonicalUrl,
                  "title" -> preview.metadata.title,
                  "author" -> preview.metadata.author,
                  "description" -> preview.metadata.description,
                  "duration" -> preview.metadata.duration,
                  "thumbnail" -> preview.metadata.thumbnail,
                  "available" -> preview.metadata.available
                )
              )
  }

  def refresh(id: Video.ID) = SecureBody(_.ManageVideos) { _ ?=> me ?=>
    Found(api.video.find(id)): video =>
      adminApi
        .refresh(video)
        .flatMap:
          case Left(error) =>
            fuccess(Redirect(routes.VideoAdmin.edit(id)).flashFailure(error))
          case Right(_) =>
            env.mod.logApi
              .video(Modlog.videoRefresh, video.id, video.title)
              .inject(Redirect(routes.VideoAdmin.edit(id)).flashSuccess("External metadata refreshed."))
  }

  def reorder = Secure(_.ManageVideos) { _ ?=> _ ?=>
    Ok.async(api.video.publishedForReorder.map(views.videoAdmin.reorder))
  }

  def reorderApply = SecureBody(_.ManageVideos) { _ ?=> me ?=>
    bindForm(reorderForm)(
      _ => Redirect(routes.VideoAdmin.reorder).flashFailure("Invalid video order."),
      order =>
        val ids = order.split(',').map(_.trim).filter(_.nonEmpty).toList
        adminApi
          .reorder(ids)
          .flatMap:
            case Left(error) => fuccess(Redirect(routes.VideoAdmin.reorder).flashFailure(error))
            case Right(_) =>
              env.mod.logApi
                .video(Modlog.videoReorder, "library", s"${ids.size} videos")
                .inject(Redirect(routes.VideoAdmin.reorder).flashSuccess("Video order saved."))
    )
  }
