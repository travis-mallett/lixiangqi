package lila.ublog
package ui

import play.api.data.Form

import lila.core.captcha.Captcha
import lila.core.config.ImageGetOrigin
import lila.core.id.CmsPageKey
import lila.ui.*

import ScalatagsTemplate.{ *, given }

final class UblogFormUi(helpers: Helpers, ui: UblogUi)(
    renderCaptcha: (Form[?], Option[Captcha]) => Context ?=> Frag
):
  import helpers.{ *, given }

  private def FormPage(title: String) =
    Page(title).css("bits.ublog.form", "bits.tagify").js(Esm("bits.ublogForm"))

  def create(user: User, f: Form[UblogForm.UblogPostData], captcha: Captcha)(using Context) =
    FormPage(s"${trans.ublog.xBlog.txt(user.username)} • ${trans.ublog.newPost.txt()}")
      .js(captchaEsm):
        main(cls := "page-menu page")(
          ui.menu(Left(user.id)),
          div(cls := "page-menu__content box ublog-post-form")(
            standardFlash,
            boxTop(h1(trans.ublog.newPost())),
            etiquette,
            inner(f, Left(user), captcha.some)
          )
        )

  def edit(post: UblogPost, f: Form[UblogForm.UblogPostData])(using ctx: Context) =
    FormPage(s"${trans.ublog.xBlog.txt(titleNameOrId(post.created.by))} • ${post.title}"):
      main(cls := "page-menu page")(
        ui.menu(Left(post.created.by)),
        div(cls := "page-menu__content box ublog-post-form")(
          standardFlash,
          boxTop(
            h1(
              if ctx.is(post.created.by) then trans.ublog.editYourBlogPost()
              else s"Edit ${usernameOrId(post.created.by)}'s post"
            )
          ),
          inner(f, Right(post), none),
          div(cls := "box-pad")(
            h2(trans.ublog.translations()),
            UblogTranslation.languages
              .filterNot(_._1 == UblogTranslation.normalize(post.language.value))
              .map: (language, name) =>
                p(a(href := routes.Ublog.editTranslation(post.id, language))(name))
          ),
          postForm(
            cls := "ublog-post-form__delete",
            action := routes.Ublog.delete(post.id),
            enctype := "multipart/form-data"
          ):
            form3.action:
              submitButton(
                cls := "button button-red button-empty yes-no-confirm",
                title := trans.ublog.deleteBlog.txt()
              )(trans.site.delete())
        )
      )

  def translation(post: UblogPost, language: String, f: Form[UblogTranslationForm.Data])(using ctx: Context) =
    FormPage(s"${post.title} • ${UblogTranslation.name(language)}").flag(_.noRobots)(
      main(cls := "box box-pad ublog-post-form")(
        h1(trans.ublog.translations(), " · ", UblogTranslation.name(language)),
        standardFlash,
        p(a(href := ui.urlOfPost(post), targetBlank)(trans.ublog.originalArticle())),
        post.translations
          .find(_.language == language)
          .flatMap(t => t.draft.orElse(t.published))
          .map: r =>
            div(cls := "ublog-translation-editor-meta")(
              p(trans.ublog.translatedBy(r.translator)),
              r.reviewer.map(reviewer => p(trans.ublog.reviewedBy(reviewer))),
              r.publishedAt.map(at => p(trans.ublog.translationPublished(), " ", semanticDate(at))),
              p(trans.ublog.translationUpdated(), " ", semanticDate(r.updated.at)),
              r.needsReview(post).option(p(trans.ublog.translationNeedsReview()))
            ),
        p(
          a(href := s"${UblogTranslation.urlOf(post, language).url}?draft=true")(
            trans.ublog.continueReadingPost()
          )
        ),
        postForm(cls := "form3", action := routes.Ublog.updateTranslation(post.id, language))(
          form3.globalError(f),
          form3.hidden(f("sourceRevision")),
          form3.hidden(f("version")),
          form3.group(f("title"), trans.ublog.postTitle())(form3.input(_)),
          form3.group(f("intro"), trans.ublog.postIntro())(form3.input(_)),
          form3.group(f("markdown"), trans.ublog.postBody()): field =>
            frag(
              form3.textarea(field)(rows := 24),
              div(
                cls := "markdown-toastui",
                data("image-upload-url") := routes.Main.uploadImage("ublogBody"),
                data("image-download-origin") := summon[ImageGetOrigin],
                data("image-count-max") := 10
              )
            ),
          form3.group(f("imageAlt"), trans.ublog.imageAlt())(form3.input(_)),
          form3.group(f("imageCredit"), trans.ublog.imageCredit())(form3.input(_)),
          form3.group(f("translator"), trans.ublog.translator())(form3.input(_)),
          form3.checkboxGroup(f("reviewed"), trans.ublog.translationReviewed()),
          form3.actions(
            submitButton(name := "action", value := "draft", cls := "button")(trans.ublog.saveDraft()),
            submitButton(name := "action", value := "publish", cls := "button button-green")(
              trans.ublog.publishTranslation()
            ),
            submitButton(name := "action", value := "unpublish", cls := "button button-red")(
              trans.ublog.unpublishTranslation()
            )
          )
        )
      )
    )

  private def inner(
      form: Form[UblogForm.UblogPostData],
      post: Either[User, UblogPost],
      captcha: Option[Captcha]
  )(using ctx: Context)(using imageGetOrigin: ImageGetOrigin) =
    postForm(
      cls := "form3 ublog-post-form__main",
      action := post.fold(u => routes.Ublog.create(u.username), p => routes.Ublog.update(p.id))
    )(
      form3.globalError(form),
      post.toOption.map: p =>
        if ctx.me.exists(me => p.canSetOfficial(using me)) then
          form3.checkboxGroup(
            form("official"),
            trans.ublog.publishAsOfficial(),
            help = trans.ublog.publishAsOfficialHelp().some
          )
        else form3.hidden(form("official"), p.isOfficial.toString.some),
      post.toOption.map(image(_, form)),
      form3.group(form("title"), trans.ublog.postTitle())(form3.input(_)(autofocus)),
      form3.group(form("intro"), trans.ublog.postIntro())(form3.input(_)(autofocus)),
      form3.group(
        form("markdown"),
        trans.ublog.postBody(),
        help = frag(
          trans.site.embedsAvailable(),
          br,
          tips
        ).some
      ): field =>
        frag(
          form3.textarea(field)(autocomplete := "off"),
          div(
            cls := "markdown-toastui",
            attr("data-image-upload-url") := routes.Main.uploadImage("ublogBody"),
            attr("data-image-download-origin") := imageGetOrigin,
            attr("data-image-count-max") := 10
          )
        ),
      post.toOption match
        case None =>
          form3.group(form("topics"), frag(trans.ublog.selectPostTopics()))(
            form3.textarea(_)(dataRel := UblogTopic.all.mkString(","))
          )
        case _ =>
          div(
            form3.split(
              form3.group(form("topics"), frag(trans.ublog.selectPostTopics()), half = true)(
                form3.textarea(_)(dataRel := UblogTopic.all.mkString(","))
              ),
              form3.group(form("language"), trans.site.language(), half = true):
                form3.select(_, langList.popularLanguagesForm.choices)
            ),
            form3.split(
              form3.checkboxGroup(
                form("discuss"),
                trans.ublog.createBlogDiscussion(),
                help = trans.ublog.createBlogDiscussionHelp().some,
                half = true
              ),
              form3.checkboxGroup(
                form("live"),
                trans.ublog.publishOnYourBlog(),
                help = trans.ublog.publishHelp().some,
                half = true
              )
            ),
            form3.split(
              form3.checkboxGroup(
                form("sticky"),
                trans.ublog.stickyPost(),
                help = trans.ublog.stickyPostHelp().some,
                half = true
              ),
              form3.checkboxGroup(
                form("ads"),
                "Includes promoted/sponsored content or referral links",
                help = ads.some,
                half = true
              )
            )
          )
      ,
      renderCaptcha(form, captcha),
      form3.actions(
        a(
          href := post
            .fold(user => routes.Ublog.index(user.username), ui.urlOfPost)
        )(
          trans.site.cancel()
        ),
        form3.submit((if post.isRight then trans.site.apply else trans.ublog.saveDraft) ())
      )
    )

  private def image(post: UblogPost, form: Form[UblogForm.UblogPostData])(using ctx: Context) =
    form3.fieldset("Image", toggle = true.some)(
      div(cls := "form-group ublog-image-edit", data("post-url") := routes.Ublog.image(post.id))(
        ui.thumbnail(post, _.Size.Large)(
          cls := "drop-target " + post.image.isDefined.so("user-image"),
          attr("draggable") := "true"
        ),
        div(
          ctx
            .is(post.created.by)
            .option(
              frag(
                p(strong(trans.ublog.uploadAnImageForYourPost())),
                p(
                  trans.ublog.safeToUseImages(),
                  fragList(
                    List(
                      "unsplash.com" -> "https://unsplash.com",
                      "commons.wikimedia.org" -> "https://commons.wikimedia.org",
                      "pixabay.com" -> "https://pixabay.com",
                      "pexels.com" -> "https://pexels.com",
                      "piqsels.com" -> "https://piqsels.com",
                      "freeimages.com" -> "https://freeimages.com"
                    ).map: (name, url) =>
                      a(href := url, targetBlank)(name)
                  )
                ),
                p(trans.ublog.useImagesYouMadeYourself()),
                p(strong(trans.streamer.maxSize(s"${lila.memo.PicfitApi.uploadMaxMb}MB."))),
                form3.file.selectImage()
              )
            )
        )
      ),
      post.image.isDefined.option(
        form3.split(
          form3.group(form("imageAlt"), trans.ublog.imageAlt(), half = true)(form3.input(_)),
          form3.group(form("imageCredit"), trans.ublog.imageCredit(), half = true)(form3.input(_))
        )(cls := s"ublog-post-form__image-text visible")
      )
    )

  private def etiquette(using Translate) =
    div(cls := "ublog-post-form__etiquette")(
      p(trans.ublog.safeAndRespectfulContent()),
      p(trans.ublog.inappropriateContentAccountClosed()),
      p(
        a(
          dataIcon := Icon.InfoCircle,
          href := routes.Cms.lonePage(CmsPageKey("blog-etiquette")),
          cls := "text",
          targetBlank
        )("Ranking your blog")
      ),
      p(tips)
    )

  def tips(using Translate) = a(
    dataIcon := Icon.InfoCircle,
    href := routes.Cms.lonePage(CmsPageKey("blog-tips")),
    cls := "text",
    targetBlank
  )(trans.ublog.blogTips())

  val ads = a(
    dataIcon := Icon.InfoCircle,
    href := routes.Cms.lonePage(CmsPageKey("blog-etiquette")),
    cls := "text",
    targetBlank
  )("Mandatory for sponsored content, affiliate links or commercial advertisement")
