package lila.forum
package ui

import lila.ui.*

import ScalatagsTemplate.{ *, given }

final class ForumBits(helpers: Helpers):
  import helpers.{ *, given }

  // Site board metadata is stored in English for logs and other non-UI consumers.
  // Team and other editorial category names remain their authors' own content.
  private val boardTranslations = Map(
    ForumCategId("general-xiangqi-discussion") ->
      (trans.forum.xiangqiDiscussion, trans.forum.xiangqiDiscussionDescription),
    ForumCategId("game-analysis") -> (trans.forum.gameAnalysis, trans.forum.gameAnalysisDescription),
    ForumCategId("lixiangqi-feedback") -> (trans.forum.feedback, trans.forum.feedbackDescription),
    ForumCategId("off-topic-discussion") -> (trans.forum.offTopic, trans.forum.offTopicDescription),
    ForumCateg.ublogId -> (trans.forum.blogDiscussions, trans.forum.blogDiscussionsDescription),
    ForumCateg.diagnosticId -> (trans.forum.diagnostics, trans.forum.diagnosticsDescription)
  )

  def categName(categ: ForumCateg)(using Translate): String =
    boardTranslations.get(categ.id).fold(categ.name)(_._1.txt())

  def categDescription(categ: ForumCateg)(using Translate): String =
    boardTranslations.get(categ.id).fold(categ.desc)(_._2.txt())

  def searchForm(search: String = "")(using Context) =
    div(cls := "box__top__actions")(
      form(cls := "search", action := routes.ForumPost.search())(
        input(
          name := "text",
          value := search,
          placeholder := trans.search.search.txt(),
          enterkeyhint := "search"
        )
      )
    )

  def authorLink(post: ForumPost, cssClass: Option[String] = None, withOnline: Boolean = true)(using
      Context
  ): Frag =
    if !Granter.opt(_.ModerateForum) && post.erased
    then span(cls := "author")("<erased>")
    else
      userIdLink(
        post.userId,
        cssClass = cssClass,
        withOnline = withOnline,
        modIcon = ~post.modIcon
      )

  val dataTopic = attr("data-topic")
  val dataUnsub = attr("data-unsub")

  def postTextarea(field: play.api.data.Field)(modifiers: Modifier*)(using Translate, Me) =
    bits.markdownTextarea("forumPostBody".some):
      form3.textarea(field, "post-text-area")(
        rows := 10,
        autocomplete := "off",
        placeholder := trans.site.pleaseBeNiceInTheForum.txt()
      )(modifiers)
