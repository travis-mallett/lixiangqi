package lila.ublog

import play.api.data.*
import play.api.data.Forms.*
import lila.common.Form.{ cleanNonEmptyText, cleanTextWithSymbols, into }

object UblogTranslationForm:
  case class Data(
      title: String,
      intro: String,
      markdown: Markdown,
      imageAlt: Option[String],
      imageCredit: Option[String],
      translator: String,
      sourceRevision: String,
      version: String,
      reviewed: Boolean,
      action: String
  )

  def version(post: UblogPost, language: String): String =
    post.translations
      .find(_.language == language)
      .fold(""): t =>
        List(t.draft, t.published).map(_.fold("")(_.updated.at.toString)).mkString("/")

  def edit(post: UblogPost, language: String)(using me: Me): Form[Data] =
    val revision = post.translations.find(_.language == language).flatMap(t => t.draft.orElse(t.published))
    Form(
      mapping(
        "title" -> cleanNonEmptyText(minLength = 1, maxLength = 160),
        "intro" -> cleanNonEmptyText(minLength = 1, maxLength = 1000),
        "markdown" -> cleanTextWithSymbols(minLength = 1, maxLength = 100000).into[Markdown],
        "imageAlt" -> optional(cleanNonEmptyText(maxLength = 300)),
        "imageCredit" -> optional(cleanNonEmptyText(maxLength = 300)),
        "translator" -> cleanNonEmptyText(maxLength = 200),
        "sourceRevision" -> nonEmptyText,
        "version" -> text,
        "reviewed" -> boolean,
        "action" -> text.verifying(Set("draft", "publish", "unpublish").contains)
      )(Data.apply)(unapply)
        .verifying(
          "ublog:translationConflict",
          d =>
            d.sourceRevision == UblogTranslation.sourceRevision(post) && d.version == version(post, language)
        )
        .verifying("ublog:translationReviewRequired", d => d.action != "publish" || d.reviewed)
        .verifying(
          "ublog:officialPostPermissionRequired",
          d => d.action != "publish" || !post.isOfficial || post.canSetOfficial
        )
    ).fill(
      Data(
        revision.fold("")(_.title),
        revision.fold("")(_.intro),
        revision.fold(Markdown(""))(_.markdown),
        revision.flatMap(_.imageAlt),
        revision.flatMap(_.imageCredit),
        revision.fold(me.username.value)(_.translator),
        UblogTranslation.sourceRevision(post),
        version(post, language),
        false,
        "draft"
      )
    )
