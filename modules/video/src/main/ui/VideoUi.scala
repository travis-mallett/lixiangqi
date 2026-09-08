package lila.video
package ui

import scalalib.paginator.Paginator

import lila.core.config.NetDomain
import lila.core.perm.Granter
import lila.ui.*

import ScalatagsTemplate.{ *, given }

final class VideoUi(helpers: Helpers)(using NetDomain):
  import helpers.{ *, given }
  import trans.video as trv

  private def page(title: String, control: UserControl)(using ctx: Context) =
    Page(title)
      .css("bits.video")
      .js(infiniteScrollEsmInit)
      .csp(csp => csp.copy(frameSrc = "https://player.bilibili.com" :: csp.frameSrc))
      .flag(_.fullScreen)
      .wrap: body =>
        main(cls := "video page-menu force-ltr")(
          menu(control),
          div(cls := "page-menu__content box")(adminTools, body)
        )

  private def adminTools(using Context) = Granter
    .opt(_.ManageVideos)
    .option:
      st.nav(cls := "video-admin-tools", aria.label := "Video library administration")(
        a(cls := "button button-green text", dataIcon := Icon.PlusButton, href := routes.VideoAdmin.form)(
          "Add video"
        ),
        a(cls := "button button-empty", href := routes.VideoAdmin.index())("Manage videos"),
        a(cls := "button button-empty", href := routes.VideoAdmin.reorder)("Reorder")
      )

  def show(video: Video, similar: Seq[VideoView], control: UserControl)(using ctx: Context) =
    page(s"${video.title} • ${trv.freeChessVideos.txt()}", control)
      .graph(
        OpenGraph(
          title = trv.xByY.txt(video.title, video.author),
          description = shorten(~video.effectiveDescription, 152),
          url = pathUrl(langHref(routes.Video.show(video.id))),
          `type` = "video"
        )
      ):
        div(cls := "show")(
          div(cls := "embed")(
            iframe(
              id := "video-player",
              tpe := "text/html",
              src := video.source.embedUrl(video.startTime),
              st.frameborder := "0",
              frame.allowfullscreen,
              frame.credentialless
            )
          ),
          (!video.isPublished).option:
            div(cls := "video-status-banner")(
              strong(video.status.label),
              " — visible only to video editors. ",
              a(href := routes.VideoAdmin.edit(video.id))("Edit video")
            )
          ,
          h1(cls := "box__pad")(
            a(
              cls := "is4 text",
              dataIcon := Icon.Back,
              href := s"${langHref(routes.Video.index)}?${control.queryString}"
            ),
            video.title
          ),
          div(cls := "meta box__pad")(
            div(cls := "target__wrapper")(
              video.targets.map { t => div(cls := "target__box")(Target.name(t)) }
            ),
            a(
              cls := "author",
              href := s"${langHref(routes.Video.author(video.author))}?${control.queryString}"
            )(video.author),
            video.tags.map: tag =>
              a(
                cls := "tag",
                dataIcon := Icon.Tag,
                href := s"${langHref(routes.Video.index)}?tags=${tag.replace(" ", "+")}"
              )(tag.capitalize),
            video.effectiveDescription.map: desc =>
              p(cls := "description")(richText(desc))
          ),
          div(cls := "similar list box__pad"):
            similar.map(card(_, control))
        )

  def index(videos: Paginator[VideoView], count: Long, control: UserControl)(using ctx: Context) =
    val tagString = control.filter.tags.nonEmptyOption.so(_.mkString(" + ") + " • ")
    page(s"${tagString}${trv.freeChessVideos.txt()}", control)
      .graph(
        title = trv.xFreeCarefullyCurated.txt(tagString),
        description = s"${trv.xCuratedChessVideos(videos.nbResults)}${
            if tagString.nonEmpty then trv.xWithTagsY(" ", tagString)
            else " • "
          }${trv.freeForAll.txt()}",
        url = pathUrl(s"${langHref(routes.Video.index)}?${control.queryString}")
      ):
        frag(
          standardFlash,
          boxTop(
            h1(
              if control.filter.tags.nonEmpty then
                frag(trv.nbVideosFound.plural(videos.nbResults, videos.nbResults.localize))
              else trv.chessVideos()
            ),
            searchForm(control.query)
          ),
          control.filter.tags.isEmpty.option(
            p(cls := "explain box__pad")(
              trv.allVideosAreFree(),
              br,
              trv.selectTagsToFilter(),
              br,
              trv.weHaveCarefullySelectedX(count.toString())
            )
          ),
          div(cls := "list box__pad infinite-scroll")(
            videos.currentPageResults.map { card(_, control) },
            (videos.currentPageResults.sizeIs < 4).option(
              div(cls := s"not_much nb_${videos.nbResults}")(
                if videos.currentPageResults.isEmpty then trv.noVideosForTheseTags()
                else trv.thatsAllWeGotForTheseTags(),
                br,
                control.filter.tags.map { tag =>
                  frag(
                    a(
                      cls := "tag",
                      dataIcon := Icon.Tag,
                      href := s"${langHref(routes.Video.index)}?tags=$tag"
                    )(tag.capitalize),
                    " "
                  )
                },
                br,
                br,
                a(href := langHref(routes.Video.index), cls := "button")(trans.site.clearSearch())
              )
            ),
            pagerNext(
              videos,
              np => s"${langHref(routes.Video.index)}?${control.queryString}&page=$np"
            )
          )
        )

  private def menu(control: UserControl)(using ctx: Context) =
    st.aside(cls := "page-menu__menu")(
      lila.ui.bits.subnav(
        control.tags.map: t =>
          val checked = control.filter.tags contains t.tag
          a(
            cls := List(
              "checked" -> checked,
              "full" -> (checked || t.nb > 0),
              "empty" -> !(checked || t.nb > 0)
            ),
            href := (checked || t.nb > 0)
              .option(s"${langHref(routes.Video.index)}?${control.toggleTag(t.tag).queryString}")
          )(
            span(t.tag.capitalize),
            (!checked && t.nb > 0).option(em(t.nb))
          )
      ),
      div(cls := "under-tags")(
        if control.filter.tags.nonEmpty then
          a(cls := "button button-empty", href := langHref(routes.Video.index))(trans.site.clearSearch())
        else a(dataIcon := Icon.Tag, href := langHref(routes.Video.tags))(trv.viewMoreTags())
      )
    )

  def card(vv: VideoView, control: UserControl)(using ctx: Context): Frag =
    a(
      cls := "card paginated",
      href := s"${langHref(routes.Video.show(vv.video.id))}?${control.queryStringUnlessBot}"
    )(
      vv.view.option(span(cls := "view")("watched")),
      span(
        cls := List("img" -> true, "missing" -> vv.video.thumbnail.isEmpty),
        vv.video.thumbnail.map(url => style := s"background-image: url($url)")
      )(
        vv.video.durationString.map(span(cls := "duration")(_))
      ),
      span(cls := "info")(
        span(cls := "title")(vv.video.title),
        span(cls := "byline")(vv.video.author)
      ),
      span(cls := "reveal")(
        span(cls := "full-title")(vv.video.title),
        span(cls := "author")(vv.video.author),
        span(cls := "target")(vv.video.targets.map { t => div(cls := "target__box")(Target.name(t)) })
      )
    )

  def author(name: String, videos: Paginator[VideoView], control: UserControl)(using ctx: Context) =
    page(s"$name • ${trv.freeChessVideos.txt()}", control):
      frag(
        boxTop(
          h1(
            a(
              cls := "is4 text",
              dataIcon := Icon.Back,
              href := s"${langHref(routes.Video.index)}?${control.queryString}"
            ),
            name
          ),
          span(trv.nbVideosFound.plural(videos.nbResults, videos.nbResults.localize))
        ),
        div(cls := "list infinite-scroll box__pad")(
          videos.currentPageResults.map { card(_, control) },
          pagerNext(
            videos,
            np => s"${langHref(routes.Video.author(name))}?${control.queryString}&page=$np"
          )
        )
      )

  def notFound(control: UserControl)(using ctx: Context) =
    page(trv.videoNotFound.txt(), control):
      boxTop(
        h1(
          a(
            cls := "is4 text",
            dataIcon := Icon.Back,
            href := s"${langHref(routes.Video.index)}"
          ),
          trv.videoNotFound()
        )
      )

  def searchForm(query: Option[String])(using Context) =
    form(cls := "search", method := "GET", action := langHref(routes.Video.index)):
      input(placeholder := trans.search.search.txt(), tpe := "text", name := "q", value := query)

  def tags(ts: List[TagNb], control: UserControl)(using ctx: Context) =
    page(s"${trans.site.tags.txt()} • ${trv.freeChessVideos.txt()}", control):
      frag(
        boxTop(
          h1(
            a(
              cls := "text",
              dataIcon := Icon.Back,
              href := s"${langHref(routes.Video.index)}?${control.queryString}"
            )(
              trv.allNbVideoTags(ts.size.toString())
            )
          )
        ),
        div(cls := "tag-list box__pad")(
          ts.sortBy(_.tag).map { t =>
            a(cls := "tag", href := s"${langHref(routes.Video.index)}?tags=${t.tag}")(
              t.tag.capitalize,
              em(" " + t.nb)
            )
          }
        )
      )

  def search(videos: Paginator[VideoView], control: UserControl)(using Context) =
    page(s"${control.query.getOrElse(trans.site.search.txt())} • ${trv.freeChessVideos.txt()}", control):
      frag(
        boxTop(
          h1(trv.nbVideosFound.plural(videos.nbResults, videos.nbResults.localize)),
          searchForm(control.query)
        ),
        div(cls := "list infinitescroll box__pad")(
          videos.currentPageResults.map { card(_, control) },
          (videos.currentPageResults.sizeIs < 4).option(
            div(cls := s"not_much nb_${videos.nbResults}")(
              if videos.currentPageResults.isEmpty then trans.site.thereAreNoResultsForX(~control.query)
              else trv.thatsAllWeGotForThisSearchX(~control.query),
              br,
              br,
              a(href := langHref(routes.Video.index), cls := "button")(trans.site.clearSearch())
            )
          ),
          pagerNext(videos, np => s"${langHref(routes.Video.index)}?${control.queryString}&page=$np")
        )
      )
