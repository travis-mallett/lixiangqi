package lila.video
package ui

import play.api.data.Form
import scalalib.paginator.Paginator

import lila.ui.*
import ScalatagsTemplate.{ *, given }

final class VideoAdminUi(helpers: Helpers):
  import helpers.{ *, given }

  private val dataPreviewUrl = attr("data-preview-url")
  private val dataVideoId = attr("data-video-id")
  private val dataTagValue = attr("data-tag")

  private def page(title: String)(body: Frag) =
    Page(title)
      .css("bits.video")
      .js(Esm("bits.videoAdmin"))
      .js(infiniteScrollEsmInit):
        main(cls := "page-wide box video-admin")(body)

  def index(
      videos: Paginator[Video],
      activeStatus: Option[VideoStatus],
      needsAttention: Boolean,
      query: Option[String]
  )(using Context) =
    page("Manage video library"):
      frag(
        boxTop(
          div(cls := "video-admin-heading")(
            span(cls := "video-admin-heading__eyebrow")("Content manager"),
            h1("Video library"),
            p("Review, organize, and publish externally hosted videos.")
          ),
          div(cls := "box__top__actions")(
            a(cls := "button button-empty", href := routes.Video.index, dataIcon := Icon.Eye)("View library"),
            a(cls := "button button-empty", href := routes.VideoAdmin.reorder)("Reorder"),
            a(
              cls := "button button-green text",
              dataIcon := Icon.PlusButton,
              href := routes.VideoAdmin.form
            )("Add video")
          )
        ),
        standardFlash,
        div(cls := "video-admin-workspace")(
          st.nav(cls := "video-admin-tabs", aria.label := "Video status")(
            filterLink("All", none, attention = false, activeStatus.isEmpty && !needsAttention),
            VideoStatus.values.map: status =>
              filterLink(status.label, status.some, attention = false, activeStatus.contains(status)),
            filterLink("Needs attention", none, attention = true, needsAttention)
          ),
          div(cls := "video-admin-toolbar")(
            form(cls := "video-admin-search", method := "get", action := routes.VideoAdmin.index())(
              activeStatus.map(status => input(tpe := "hidden", name := "status", value := status.key)),
              needsAttention.option(input(tpe := "hidden", name := "attention", value := "1")),
              input(
                cls := "form-control",
                tpe := "search",
                name := "q",
                value := query,
                aria.label := "Search videos",
                placeholder := "Search by title, channel, or tag"
              ),
              query.map(_ =>
                a(cls := "video-admin-search__clear", href := routes.VideoAdmin.index())("Clear")
              ),
              button(cls := "button text", tpe := "submit", dataIcon := Icon.Search)("Search")
            ),
            span(cls := "video-admin-result-count")(
              strong(videos.nbResults),
              if videos.nbResults == 1 then " video" else " videos"
            )
          ),
          if videos.currentPageResults.isEmpty then
            div(cls := "video-admin-empty")(
              h2(if query.isDefined then "No matching videos" else "No videos here yet"),
              p(
                if query.isDefined then "Try a different search or status filter."
                else "Add an externally hosted video to start building the library."
              ),
              a(
                cls := "button button-green text",
                dataIcon := Icon.PlusButton,
                href := routes.VideoAdmin.form
              )(
                "Add video"
              )
            )
          else
            div(cls := "table-responsive video-admin-table-wrap")(
              table(cls := "slist video-admin-list")(
                thead(
                  tr(
                    th("Video"),
                    th(cls := "video-admin-list__provider-column")("Provider"),
                    th(cls := "video-admin-list__status-column")("Status"),
                    th(cls := "video-admin-list__updated-column")("Updated"),
                    th(cls := "video-admin-list__actions-column")("Actions")
                  )
                ),
                tbody(cls := "infinite-scroll")(
                  videos.currentPageResults.map(videoRow),
                  pagerNextTable(
                    videos,
                    page =>
                      addQueryParams(
                        routes.VideoAdmin.index().url,
                        Map(
                          "page" -> page.toString,
                          "status" -> activeStatus.fold("")(_.key),
                          "attention" -> needsAttention.so("1"),
                          "q" -> query.getOrElse("")
                        ).filter(_._2.nonEmpty)
                      )
                  )
                )
              )
            )
        )
      )

  private def filterLink(
      label: String,
      status: Option[VideoStatus],
      attention: Boolean,
      active: Boolean
  ) =
    a(
      cls := active.option("active"),
      href := addQueryParams(
        routes.VideoAdmin.index().url,
        status.fold(Map.empty[String, String]) { value => Map("status" -> value.key) } ++
          attention.option(Map("attention" -> "1")).getOrElse(Map.empty)
      )
    )(label)

  private def videoRow(video: Video) =
    tr(
      td(
        div(cls := "video-admin-list__video")(
          div(cls := "video-admin-list__thumbnail")(
            video.thumbnail.fold[Frag](span("No thumbnail"))(url => img(src := url, alt := ""))
          ),
          div(cls := "video-admin-list__copy")(
            a(cls := "video-admin-list__title", href := routes.VideoAdmin.edit(video.id))(video.title),
            div(cls := "video-admin-list__byline")(video.author),
            video.tags.nonEmpty.option:
              div(cls := "video-admin-list__tags")(
                video.tags.take(3).map(tag => span(tag)),
                (video.tags.size > 3).option(span(s"+${video.tags.size - 3}"))
              )
            ,
            div(cls := "video-admin-list__mobile-meta")(
              span(video.source.provider.label),
              span(cls := s"video-status video-status--${video.status.key}")(video.status.label),
              momentFromNow(video.updatedAt)
            ),
            video.metadata.error.map(error => small(cls := "error")(error)),
            (!video.metadata.available).option(small(cls := "error")("Provider reports unavailable"))
          )
        )
      ),
      td(cls := "video-admin-list__provider-column")(
        span(cls := "video-provider-badge")(video.source.provider.label)
      ),
      td(cls := "video-admin-list__status-column")(
        span(cls := s"video-status video-status--${video.status.key}")(video.status.label)
      ),
      td(cls := "video-admin-list__updated-column")(momentFromNow(video.updatedAt)),
      td(cls := "video-admin-list__actions-column")(
        div(cls := "video-admin-list__actions")(
          a(cls := "button button-empty", href := routes.VideoAdmin.edit(video.id), dataIcon := Icon.Pencil)(
            "Edit"
          ),
          a(cls := "button button-empty", href := routes.Video.show(video.id), dataIcon := Icon.Eye)("View"),
          video.status match
            case VideoStatus.Published => statusForm(video, VideoStatus.Draft, "Unpublish")
            case VideoStatus.Draft => statusForm(video, VideoStatus.Published, "Publish")
            case VideoStatus.Archived => statusForm(video, VideoStatus.Draft, "Restore")
        )
      )
    )

  private def statusForm(video: Video, status: VideoStatus, label: String) =
    postForm(cls := "inline", action := routes.VideoAdmin.status(video.id, status.key))(
      button(cls := "button button-empty", tpe := "submit")(label)
    )

  def create(form: Form[VideoForm.Data], tags: List[TagNb])(using Context) =
    editPage("Add video", form, none, tags, routes.VideoAdmin.create)

  def edit(video: Video, form: Form[VideoForm.Data], tags: List[TagNb])(using Context) =
    editPage(s"Edit ${video.title}", form, video.some, tags, routes.VideoAdmin.update(video.id))

  private def editPage(
      pageTitle: String,
      form: Form[VideoForm.Data],
      video: Option[Video],
      tags: List[TagNb],
      submitAction: play.api.mvc.Call
  )(using Context) =
    val selectedTags = form("tags").value.toList
      .flatMap(_.split("[,;\\n]"))
      .map(_.trim.toLowerCase)
      .filter(_.nonEmpty)
      .toSet
    page(pageTitle):
      frag(
        boxTop(
          div(cls := "video-admin-heading")(
            span(cls := "video-admin-heading__eyebrow")(video.fold("New library item")(_ => "Video details")),
            h1(pageTitle),
            p(
              video.fold("Add a YouTube or Bilibili video without uploading media to Lixiangqi."): current =>
                s"${current.source.provider.label} • ${current.status.label}"
            )
          ),
          div(cls := "box__top__actions")(
            a(cls := "button button-empty", href := routes.VideoAdmin.index())("Back to videos"),
            video.map: current =>
              a(cls := "button button-empty", href := routes.Video.show(current.id), dataIcon := Icon.Eye)(
                "Preview"
              ),
            video.map: current =>
              postForm(cls := "inline", action := routes.VideoAdmin.refresh(current.id))(
                button(cls := "button button-empty", tpe := "submit", dataIcon := Icon.Reload)(
                  "Refresh metadata"
                )
              )
          )
        ),
        standardFlash,
        div(cls := "video-admin-form box-pad")(
          postForm(cls := "form3 video-editor", action := submitAction)(
            form3.globalError(form),
            st.section(cls := "video-editor-card video-editor-source")(
              div(cls := "video-editor-card__heading")(
                div(
                  h2("Video source"),
                  p("Paste the public video URL, then import its available details.")
                ),
                span(cls := "video-editor-step")("1")
              ),
              form3.group(
                form("sourceUrl"),
                "External video URL",
                help = frag("YouTube and Bilibili links are supported.").some
              ): field =>
                div(cls := "video-source-input")(
                  form3
                    .input(field, typ = "url")(autofocus, placeholder := "https://www.youtube.com/watch?v=…"),
                  button(
                    cls := "button video-metadata-preview",
                    tpe := "button",
                    dataPreviewUrl := routes.VideoAdmin.preview.url
                  )("Fetch details")
                ),
              div(cls := "video-metadata-result", aria.live := "polite")(
                video match
                  case Some(current) =>
                    frag(
                      current.thumbnail.map(url => img(src := url, alt := "Video thumbnail")),
                      div(cls := "video-metadata-result__copy")(
                        strong(s"${current.source.provider.label} video connected"),
                        span("Metadata last checked ", momentFromNow(current.metadata.refreshedAt)),
                        current.metadata.error.map(error => span(cls := "error")(error)),
                        (!current.metadata.available).option(
                          span(cls := "error")("Provider reports unavailable")
                        )
                      )
                    )
                  case None =>
                    div(cls := "video-metadata-result__empty")(
                      strong("No preview yet"),
                      span("Fetch details to verify the link and fill in available metadata.")
                    )
              )
            ),
            div(cls := "video-editor-layout")(
              st.section(cls := "video-editor-card video-editor-details")(
                div(cls := "video-editor-card__heading")(
                  div(h2("Details"), p("Describe the video so people can find the right lesson quickly.")),
                  span(cls := "video-editor-step")("2")
                ),
                form3.split(
                  form3.group(form("title"), "Title", half = true)(form3.input(_)),
                  form3.group(form("author"), "Author or channel", half = true)(form3.input(_))
                ),
                form3.group(
                  form("description"),
                  "Description",
                  help = frag("Optional. If left blank, the provider description is shown.").some
                )(form3.textarea(_)(rows := 7)),
                form3.group(
                  form("tags"),
                  "Tags",
                  help = frag("Add up to 20 tags with commas, or choose from existing library tags.").some
                ): field =>
                  div(cls := "video-tag-picker")(
                    div(cls := "video-tag-picker__selected", aria.live := "polite")(
                      selectedTags.toList.sorted.map: tag =>
                        span(cls := "video-tag-chip")(
                          span(tag),
                          button(
                            cls := "video-tag-remove",
                            tpe := "button",
                            dataTagValue := tag,
                            aria.label := s"Remove $tag tag"
                          )("×")
                        )
                    ),
                    form3.input(field)(placeholder := "Type a tag, then add a comma"),
                    tags.nonEmpty.option:
                      div(cls := "video-tag-picker__popular")(
                        span(cls := "video-tag-picker__label")("Existing tags"),
                        div(cls := "video-tag-picker__options")(
                          tags
                            .sortBy(tag => (-tag.nb, tag.tag))
                            .map: tag =>
                              val selected = selectedTags.contains(tag.tag)
                              button(
                                cls := List("video-tag-option" -> true, "is-selected" -> selected),
                                tpe := "button",
                                dataTagValue := tag.tag,
                                aria.pressed := selected.toString
                              )(span(tag.tag), small(tag.nb))
                        )
                      )
                  )
              ),
              st.aside(cls := "video-editor-sidebar")(
                st.section(cls := "video-editor-card")(
                  div(cls := "video-editor-card__heading")(
                    div(h2("Audience & playback"), p("Control where this lesson fits in the library.")),
                    span(cls := "video-editor-step")("3")
                  ),
                  form3.group(
                    form("targets"),
                    "Skill levels",
                    klass = "video-target-options",
                    help = frag("Choose every level that benefits from this video.").some
                  ): field =>
                    checkboxes(
                      field,
                      Target.choices,
                      form.value.fold(Set.empty[Int])(_.targets.toSet),
                      "video-target-"
                    ),
                  form3.split(
                    form3.group(
                      form("lang"),
                      "Language",
                      half = true,
                      help = frag("Example: en, zh, or vi.").some
                    )(form3.input(_)),
                    form3.group(
                      form("startTime"),
                      "Start at",
                      half = true,
                      help = frag("Seconds from the beginning.").some
                    )(form3.input(_, typ = "number"))
                  )
                ),
                st.section(cls := "video-editor-card")(
                  div(cls := "video-editor-card__heading")(
                    div(h2("Visibility"), p("Choose whether the video is ready for the public library.")),
                    span(cls := "video-editor-step")("4")
                  ),
                  form3.group(form("status"), "Status")(
                    form3.select(_, VideoStatus.choices)
                  ),
                  form3.checkboxGroup(
                    form("ads"),
                    "Contains paid promotion",
                    help = frag("Label externally sponsored or promotional content.").some
                  )
                )
              )
            ),
            form3.actions(
              a(cls := "button button-empty", href := routes.VideoAdmin.index())("Cancel"),
              form3.submit(video.fold("Add video")(_ => "Save changes"))
            )
          ),
          video
            .filterNot(_.status == VideoStatus.Archived)
            .map: current =>
              div(cls := "video-danger-zone")(
                div(
                  strong("Archive video"),
                  p("Remove this video from normal management views without deleting its record.")
                ),
                postForm(action := routes.VideoAdmin.status(current.id, VideoStatus.Archived.key))(
                  button(
                    cls := "button button-red button-empty yes-no-confirm",
                    tpe := "submit",
                    dataIcon := Icon.Trash,
                    title := "Archive this video?"
                  )("Archive video")
                )
              )
        )
      )

  def reorder(videos: List[Video])(using Context) =
    page("Reorder video library"):
      frag(
        boxTop(
          div(cls := "video-admin-heading")(
            span(cls := "video-admin-heading__eyebrow")("Library organization"),
            h1("Reorder videos"),
            p("Set the default order visitors see in the published library.")
          ),
          div(cls := "box__top__actions")(
            a(cls := "button button-empty", href := routes.VideoAdmin.index())("Back to videos"),
            a(cls := "button button-empty", href := routes.Video.index)("View library")
          )
        ),
        standardFlash,
        div(cls := "video-admin-reorder box-pad")(
          div(cls := "video-admin-reorder__intro")(
            strong("Published videos"),
            p("Drag each row by its handle, or use the arrow buttons for keyboard-friendly ordering.")
          ),
          postForm(action := routes.VideoAdmin.reorderApply)(
            input(
              tpe := "hidden",
              id := "video-order-value",
              name := "order",
              value := videos.map(_.id).mkString(",")
            ),
            ol(cls := "video-reorder-list")(
              videos.map: video =>
                li(dataVideoId := video.id)(
                  span(cls := "video-reorder-handle", dataIcon := Icon.Move, aria.hidden := "true"),
                  div(cls := "video-reorder-thumbnail")(
                    video.thumbnail.fold[Frag](span("No thumbnail"))(url => img(src := url, alt := ""))
                  ),
                  span(cls := "video-reorder-copy")(strong(video.title), small(video.author)),
                  span(cls := "video-reorder-buttons")(
                    button(
                      cls := "button button-empty video-reorder-up",
                      tpe := "button",
                      dataIcon := Icon.UpTriangle,
                      aria.label := s"Move ${video.title} up"
                    ),
                    button(
                      cls := "button button-empty video-reorder-down",
                      tpe := "button",
                      dataIcon := Icon.DownTriangle,
                      aria.label := s"Move ${video.title} down"
                    )
                  )
                )
            ),
            div(cls := "form-actions single")(
              button(cls := "button submit text", dataIcon := Icon.Checkmark, tpe := "submit")("Save order")
            )
          )
        )
      )
