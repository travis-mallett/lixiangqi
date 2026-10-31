package lila.forum
package ui

import scalalib.paginator.Paginator

import lila.ui.*

import ScalatagsTemplate.{ *, given }

final class CategUi(helpers: Helpers, bits: ForumBits):
  import helpers.{ *, given }

  def index(categs: List[CategView], canWrite: Boolean)(using Context) =
    Page(trans.site.forum.txt())
      .css("bits.forum")
      .csp(_.withInlineIconFont)
      .graph(
        title = s"LiXiangQi ${trans.site.forum.txt()}",
        url = routeUrl(routes.ForumCateg.index),
        description = s"LiXiangQi ${trans.site.forum.txt()}"
      ):
        val (teamCategs, globalCategs) = categs.partition(_.categ.isTeam)
        val (privateCategs, publicCategs) = globalCategs.partition(_.categ.hidden)
        main(cls := "forum index box")(
          boxTop(
            h1(dataIcon := Icon.BubbleConvo, cls := "text")("LiXiangQi ", trans.site.forum()),
            div(cls := "forum-index__actions")(
              bits.searchForm(),
              (canWrite && publicCategs.nonEmpty).option(
                tag("details")(cls := "forum-compose")(
                  tag("summary")(cls := "button text", dataIcon := Icon.Pencil)(trans.forum.newTopic()),
                  div(cls := "forum-compose__choices")(
                    p(trans.forum.chooseSection()),
                    publicCategs.map: view =>
                      a(href := routes.ForumTopic.form(view.slug))(bits.categName(view.categ))
                  )
                )
              )
            )
          ),
          div(cls := "forum-directory")(
            p(cls := "forum-directory__intro")(trans.forum.introduction()),
            h2(trans.forum.sections()),
            showCategs(publicCategs),
            teamCategs.nonEmpty.option(
              st.section(
                h2(trans.forum.teamBoards()),
                showCategs(teamCategs)
              )
            ),
            privateCategs.nonEmpty.option(
              tag("details")(cls := "forum-private")(
                tag("summary")(
                  if Granter.opt(_.ModerateForum) then trans.forum.moderatorBoards()
                  else trans.forum.privateDiscussions()
                ),
                Granter.opt(_.ModerateForum).option(p(trans.forum.moderatorBoardsDescription())),
                showCategs(privateCategs)
              )
            )
          )
        )

  def show(
      categ: lila.forum.ForumCateg,
      topics: Paginator[TopicView],
      canWrite: Boolean,
      stickyPosts: List[TopicView]
  )(using Context) =

    // Public-board pagination uses an approximate total to avoid counting large forums.
    // The actual page contents determine whether there is anything to render.
    val hasTopics = topics.currentPageResults.nonEmpty || stickyPosts.nonEmpty

    def showTopic(sticky: Boolean)(topic: TopicView) =
      tr(cls := List("sticky" -> sticky))(
        td(cls := "subject")(
          a(href := routes.ForumTopic.show(categ.id, topic.slug))(topic.name)
        ),
        td(cls := "right", attr("data-label") := trans.site.replies.txt())(topic.nbReplies.localize),
        td(
          topic.lastPost.map: post =>
            frag(
              a(href := s"${routes.ForumTopic.show(categ.id, topic.slug, topic.lastPage)}#${post.id}")(
                momentFromNow(post.createdAt)
              ),
              br,
              trans.site.by(bits.authorLink(post))
            )
        )
      )

    Page(bits.categName(categ))
      .css("bits.forum")
      .csp(_.withInlineIconFont)
      .js(infiniteScrollEsmInit)
      .graph(
        title = s"Forum: ${bits.categName(categ)}",
        url = routeUrl(routes.ForumCateg.show(categ.id)),
        description = bits.categDescription(categ)
      ):
        main(cls := "forum forum-categ box")(
          st.nav(cls := "forum-breadcrumb", attr("aria-label") := trans.site.forum.txt())(
            a(href := routes.ForumCateg.index)(trans.site.forum()),
            span(attr("aria-hidden") := "true")(" / "),
            span(attr("aria-current") := "page")(bits.categName(categ))
          ),
          boxTop(
            h1(
              categ.team.fold(frag(bits.categName(categ)))(teamLink(_, true))
            ),
            div(cls := "box__top__actions")(
              Granter
                .opt(_.ModerateForum)
                .option(
                  a(
                    href := routes.ForumCateg.modFeed(categ.id),
                    cls := "button button-empty text"
                  )("Mod feed")
                ),
              canWrite.option(
                a(
                  href := routes.ForumTopic.form(categ.id),
                  cls := "button text",
                  dataIcon := Icon.Pencil
                )(trans.site.createANewTopic())
              )
            )
          ),
          p(cls := "forum-categ__description")(bits.categDescription(categ)),
          (!hasTopics).option(
            div(cls := "forum-empty")(
              h2(trans.forum.noDiscussions()),
              p(trans.forum.firstTopic()),
              canWrite.option(
                a(cls := "button text", dataIcon := Icon.Pencil, href := routes.ForumTopic.form(categ.id))(
                  trans.site.createANewTopic()
                )
              )
            )
          ),
          hasTopics.option(
            table(cls := "topics slist slist-pad")(
              thead(
                tr(
                  th(trans.forum.topic()),
                  th(cls := "right")(trans.site.replies()),
                  th(trans.site.lastPost())
                )
              ),
              tbody(cls := "infinite-scroll")(
                stickyPosts.map(showTopic(sticky = true)),
                topics.currentPageResults.map(showTopic(sticky = false)),
                pagerNextTable(topics, n => routes.ForumCateg.show(categ.id, n).url)
              )
            )
          )
        )

  private def showCategs(categs: List[CategView])(using Context) =
    ul(cls := "forum-sections")(
      categs.map: view =>
        val canBrowse = !view.categ.hidden || Granter.opt(_.ModerateForum)
          || (view.categ.isDiagnostic && Granter.opt(_.Diagnostics))
        val categUrl = view.lastPost.filter(_ => !canBrowse).fold(routes.ForumCateg.show(view.slug)) {
          case (topic, _, _) => routes.ForumTopic.show(view.slug, topic.slug, 1)
        }
        li(cls := "forum-section")(
          div(cls := "forum-section__identity")(
            h3(a(href := categUrl)(bits.categName(view.categ))),
            p(bits.categDescription(view.categ)),
            a(cls := "forum-section__browse", href := categUrl)(trans.forum.viewTopics())
          ),
          dl(cls := "forum-section__counts")(
            div(dt(trans.site.topics()), dd((if canBrowse then view.nbTopics else 1).localize)),
            div(
              dt(trans.site.posts()),
              dd((if canBrowse then view.nbPosts else view.lastPost.fold(0)(_._1.nbPosts)).localize)
            )
          ),
          div(cls := "forum-section__latest")(
            span(cls := "forum-section__label")(trans.forum.latestDiscussion()),
            view.lastPost.fold[Frag](p(cls := "forum-section__empty")(trans.forum.noDiscussions())) {
              case (topic, post, page) =>
                frag(
                  a(
                    cls := "forum-section__topic",
                    href := s"${routes.ForumTopic.show(view.slug, topic.slug, page)}#${post.id}"
                  )(topic.name),
                  div(cls := "forum-section__byline")(
                    bits.authorLink(post),
                    momentFromNow(post.createdAt)
                  )
                )
            }
          )
        )
    )

  def modFeed(
      categ: lila.forum.ForumCateg,
      posts: Paginator[PostView]
  )(using Context) =
    paginationByQuery(routes.ForumCateg.modFeed(categ.id, 1), posts, showPost = true)
    Page(bits.categName(categ))
      .css("bits.forum")
      .csp(_.withInlineIconFont)
      .js(infiniteScrollEsmInit):
        main(cls := "forum forum-mod-feed box")(
          boxTop(
            h1(
              a(
                href := routes.ForumCateg.show(categ.id),
                dataIcon := Icon.LessThan,
                cls := "text"
              )(bits.categName(categ)),
              " mod feed"
            )
          ),
          table(cls := "slist slist-pad")(
            thead(tr(th("User"), th("Topic"), th("Post"), th("Date"))),
            tbody(cls := "infinite-scroll")(
              posts.currentPageResults.map: p =>
                tr(cls := "paginated")(
                  td(userIdLink(p.post.userId)),
                  td(a(href := routes.ForumTopic.show(p.categ.id, p.topic.slug))(p.topic.name)),
                  td(shorten(Markdown(p.post.text).unlink, 400)),
                  td(a(href := routes.ForumPost.redirect(p.post.id))(momentFromNow(p.post.createdAt)))
                ),
              pagerNextTable(posts, np => routes.ForumCateg.modFeed(categ.id, np).url)
            )
          )
        )
