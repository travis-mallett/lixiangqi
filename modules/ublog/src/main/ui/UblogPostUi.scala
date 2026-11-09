package lila.ublog
package ui

import lila.ui.*

import ScalatagsTemplate.{ *, given }

final class UblogPostUi(helpers: Helpers, ui: UblogUi)(connectLinks: Frag):
  import helpers.{ *, given }

  def page(
      user: User,
      blog: UblogBlog,
      edition: UblogTranslation.Edition,
      markup: Html,
      others: List[UblogPost.PreviewPost],
      liked: Boolean,
      followable: Boolean,
      followed: Boolean,
      isInCarousel: Boolean
  )(using ctx: Context) =
    val post = edition.post
    val imageUrl = post.image.isDefined.option(ui.thumbnailUrl(post, _.Size.Large))
    Page(s"${trans.ublog.xBlog.txt(user.username)} • ${edition.title}")
      .css("bits.ublog")
      .js(Esm("bits.expandText") ++ List(Esm("bits.ublog").some))
      .copy(contentLanguage = Some(edition.language))
      .canonical(routeUrl(edition.url))
      .graph:
        OpenGraph(
          `type` = "article",
          image = imageUrl,
          title = edition.title,
          url = routeUrl(edition.url),
          description = edition.intro
        )
      .headAppend(
        frag(
          lila.ui.bits.markdownAlternate(edition.url.url),
          edition.isPublished.option(
            UblogTranslation
              .available(post)
              .map: language =>
                link(
                  rel := "alternate",
                  attr("hreflang") := language,
                  href := routeUrl(UblogTranslation.urlOf(post, language))
                )
          )
        )
      )
      .preloadImage(imageUrl)(helpers)
      .copy(atomLinkTag =
        link(
          href := routes.Ublog.userAtom(user.username),
          st.title := trans.ublog.xBlog.txt(user.username)
        ).some
      )
      .flag(
        _.noRobots,
        !blog.listed || !post.visibleByCrawlers || !edition.isPublished || (!post.isOfficial && blog.tier < UblogBlog.Tier.HIGH)
      )
      .csp(_.withTwitter.withInlineIconFont):
        main(cls := "page-menu page-small")(
          ui.menu(if post.isOfficial then Right("official") else Left(user.id)),
          div(
            cls := "page-menu__content box box-pad ublog-post",
            st.lang := edition.language,
            data("post-id") := post.id,
            data("language") := edition.language,
            data("source-language") := UblogTranslation.normalize(post.language.value)
          )(
            edition.image.map: image =>
              frag(
                ui.thumbnail(post.copy(image = Some(image)), _.Size.Large)(cls := "ublog-post__image"),
                image.credit.map { p(cls := "ublog-post__image-credit")(_) }
              ),
            (ctx.is(user) || Granter.opt(_.ModerateBlog)).option(standardFlash),
            h1(cls := "ublog-post__title")(edition.title),
            languages(edition),
            Granter
              .opt(_.ModerateBlog)
              .option:
                div(id := "mod-tools-container")(modTools(post, isInCarousel))
            ,
            div(cls := "ublog-post__meta", st.lang := ctx.lang.code)(
              a(
                cls := userClass(user.id, none, withOnline = true),
                href := routes.Ublog.index(user.username),
                dataHref := routes.User.show(user.username)
              )(userLinkContent(user)),
              if post.isOfficial then a(href := routes.Ublog.official())(trans.ublog.officialPost())
              else
                iconTag(Icon.InfoCircle)(
                  cls := "ublog-post__meta__disclaimer",
                  st.title := "Opinions expressed by Lichess contributors are their own."
                )
              ,
              post.lived.map: live =>
                span(cls := "ublog-post__meta__date")(semanticDate(live.at)),
              post.live.option(likeButton(post, liked, showText = false)),
              post.live.option(
                span(cls := "ublog-post__views")(
                  trans.ublog.nbViews.plural(post.views.value, strong(post.views.value.localize))
                )
              ),
              if ctx.is(user) then
                div(cls := "ublog-post__meta__owner")(
                  if post.live then goodTag(trans.ublog.thisPostIsPublished())
                  else badTag(trans.ublog.thisIsADraft()),
                  " ",
                  editButton(post)
                )
              else if post.allows.edit then editButton(post)
              else if !post.live then badTag(trans.ublog.thisIsADraft())
              else
                a(
                  titleOrText(trans.site.reportXToModerators.txt(user.username)),
                  cls := "button button-empty ublog-post__meta__report",
                  href := addQueryParams(
                    routes.Report.form.url,
                    Map(
                      "username" -> user.username.value,
                      "postUrl" -> routeUrl(ui.urlOfPost(post)).value,
                      "from" -> "ublog"
                    )
                  ),
                  dataIcon := Icon.CautionTriangle
                )
              ,
              UblogTranslation.name(edition.language)
            ),
            div(cls := "ublog-post__topics")(
              post.topics.map: topic =>
                a(href := routes.Ublog.topic(topic.url, none, lila.core.ublog.BlogsBy.newest, 1))(topic.value)
            ),
            (~post.ads).option(
              div(dataIcon := Icon.InfoCircle, cls := "ublog-post__ads-disclosure text")(
                "Contains sponsored content, affiliate links or commercial advertisement"
              )
            ),
            strong(cls := "ublog-post__intro")(edition.intro),
            div(cls := "ublog-post__markup expand-text")(markup),
            post.isOfficial.option(
              div(cls := "ublog-post__lichess")(
                connectLinks,
                p(a(href := routes.Plan.index())(trans.site.lichessPatronInfo()))
              )
            ),
            div(cls := "ublog-post__footer", st.lang := ctx.lang.code)(
              (post.live && ~post.discuss && ctx.kid.no).option(
                a(
                  href := routes.Ublog.discuss(post.id),
                  cls := "button text ublog-post__discuss",
                  dataIcon := Icon.BubbleConvo
                )(trans.ublog.discussThisBlogPostInTheForum())
              ),
              (ctx.isAuth && ctx.isnt(user)).option(
                div(cls := "ublog-post__actions")(
                  likeButton(post, liked, showText = true),
                  followable.option(followButton(user, followed))
                )
              ),
              (others.length > 0).option(
                div(
                  h2("You may also like"),
                  div(cls := "ublog-post-cards")(
                    others.map:
                      ui.card(_, showAuthor = ui.ShowAt.top, showIntro = true)
                  )
                )
              )
            )
          )
        )

  def markdownForAgents(edition: UblogTranslation.Edition): String =
    s"""---
title: ${edition.title}
description: ${edition.intro}
language: ${edition.language}
image: ${ui.thumbnailUrl(edition.post, _.Size.Large)}
---

${edition.markdown}
"""

  private def languages(edition: UblogTranslation.Edition)(using ctx: Context): Frag =
    val post = edition.post
    val preferred = ui.preferredLanguage
    div(cls := "ublog-post__languages", st.lang := ctx.lang.code)(
      span(trans.ublog.articleLanguage()),
      (!edition.isPublished).option(badTag(trans.ublog.thisIsADraft())),
      UblogTranslation
        .available(post)
        .map: language =>
          a(
            href := s"${UblogTranslation.urlOf(post, language).url}?selectLanguage=true",
            attr("hreflang") := language,
            st.lang := language,
            attr("aria-current") := Option.when(language == edition.language)("page")
          )(
            UblogTranslation.name(language)
          ),
      (!UblogTranslation.available(post).contains(preferred)).option(
        p(cls := "ublog-post__language-fallback")(trans.ublog.translationUnavailable())
      )
    )

  def missingEdition(post: UblogPost)(using Context) =
    Page(trans.ublog.translationUnavailable.txt())
      .css("bits.ublog")
      .flag(_.noRobots)(
        main(
          cls := "box box-pad ublog-missing-edition",
          data("post-id") := post.id,
          data("source-language") := UblogTranslation.normalize(post.language.value)
        )(
          h1(trans.ublog.translationUnavailable()),
          UblogTranslation
            .available(post)
            .map: language =>
              p(
                a(
                  href := UblogTranslation.urlOf(post, language),
                  attr("hreflang") := language,
                  st.lang := language
                )(UblogTranslation.name(language))
              )
        )
      )

  private def editButton(post: UblogPost)(using Context) = a(
    href := ui.editUrlOfPost(post),
    cls := "button button-empty text",
    dataIcon := Icon.Pencil
  )(trans.site.edit())

  private def likeButton(post: UblogPost, liked: Boolean, showText: Boolean)(using Context) =
    val text = if liked then trans.site.liked.txt() else trans.site.like.txt()
    button(
      tpe := "button",
      cls := List(
        "ublog-post__like is" -> true,
        "ublog-post__like--liked" -> liked,
        "ublog-post__like--big button button-metal" -> showText,
        "ublog-post__like--mini button-link" -> !showText
      ),
      dataRel := post.id,
      title := text
    )(
      span(cls := "ublog-post__like__nb")(post.likes.value.localize),
      showText.option(
        span(
          cls := "button-label"
        )(text)
      )
    )

  private def followButton(user: User, followed: Boolean)(using Context) =
    val (text, route) =
      if followed then (trans.site.unfollowX, routes.Relation.unfollow)
      else (trans.site.followX, routes.Relation.follow)
    button(
      cls := List(
        "ublog-post__follow button button-metal is" -> true,
        "ublog-post__follow__followed" -> followed
      ),
      dataRel := s"${route(user.id)}?mini=1"
    )(
      span(cls := "button-label", attr("data-username") := user.titleUsername)(text(user.titleUsername))
    )

  def modTools(post: UblogPost, isInCarousel: Boolean) =
    val am = post.automod
    val evergreen = ~am.flatMap(_.evergreen)
    val flagged = ~am.flatMap(_.flagged)
    val comm = ~am.flatMap(_.commercial)

    div(id := "mod-tools", data("url") := routes.Ublog.modPost(post.id).url)(
      div(
        span(cls := "btn-rack")(
          lila.core.ublog.Quality.values.map: q =>
            button(
              cls := s"quality-btn btn-rack__btn ${am.exists(_.quality == q).so("lit")}",
              value := q.ordinal.toString
            )(q.name.capitalize)
        ),
        fieldset(cls := "carousel-fields")(
          legend(a(href := routes.Ublog.modShowCarousel)("Edit Carousel"), isInCarousel.option("(live)")),
          if isInCarousel then button(cls := "button button-metal carousel-remove-btn")("Remove")
          else
            span(
              button(cls := "button button-metal carousel-add-btn")("add"),
              "or",
              button(cls := "button button-metal carousel-pin-btn")("pin")
            )
        ),
        span(cls := "ublog-mod-assess-footer")(
          button(cls := "button button-metal assess-btn", data("url") := routes.Ublog.modAssess(post.id))(
            if am.isDefined then "reassess" else "assess"
          ),
          am.flatMap(_.lockedBy).map(u => span(s"* $u"))
        )
      ),
      fieldset(cls := "submit-fields")(
        legend("Tags", button(cls := "button button-empty none submit")("Submit")),
        span(
          "Evergreen",
          input(id := "evergreen", tpe := "checkbox", evergreen.option(checked)),
          "(for recommendations)"
        ),
        span(cls := s"commercial ${comm.isEmpty.so("empty")}", title := comm)(
          "Commercial",
          input(id := "commercial", value := comm)
        ),
        span(cls := s"flagged ${flagged.isEmpty.so("empty")}", title := flagged)(
          "Flagged",
          input(id := "flagged", value := flagged)
        )
      )
    )
