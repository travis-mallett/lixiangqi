package lila.ublog

import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import play.api.libs.json.Json

/** Editions belong to a post, never to another post ID. Published content remains readable while an editor
  * prepares its next draft.
  */
case class UblogTranslation(
    language: String,
    draft: Option[UblogTranslation.Revision],
    published: Option[UblogTranslation.Revision]
):
  def preview = UblogTranslation.Preview(language, published.map(_.preview))

object UblogTranslation:
  val languages = List(
    "en" -> "English",
    "zh-Hans" -> "简体中文",
    "vi" -> "Tiếng Việt",
    "es" -> "Español",
    "pt" -> "Português"
  )

  def normalize(language: String): String = language.toLowerCase match
    case "zh" | "zh-cn" | "zh-sg" | "zh-hans" => "zh-Hans"
    case l if l.startsWith("vi-") => "vi"
    case l if l.startsWith("en-") => "en"
    case l if l == "es" || l.startsWith("es-") => "es"
    case l if l == "pt" || l.startsWith("pt-") => "pt"
    case _ => language

  def name(language: String): String = languages.toMap.getOrElse(language, language)

  // Content-addressed revision: metadata-only edits do not invalidate translations.
  // Include the shared cover identity so replacing a diagram also requests review.
  def sourceRevision(post: UblogPost): String =
    val source = Json.stringify(
      Json.arr(
        normalize(post.language.value),
        post.title,
        post.intro,
        post.markdown.value,
        post.image.map(_.id.value),
        post.image.flatMap(_.alt),
        post.image.flatMap(_.credit)
      )
    )
    MessageDigest.getInstance("SHA-256").digest(source.getBytes(UTF_8)).map(b => f"${b & 0xff}%02x").mkString

  case class Revision(
      title: String,
      intro: String,
      markdown: Markdown,
      imageAlt: Option[String],
      imageCredit: Option[String],
      sourceRevision: String,
      translator: String,
      updated: UblogPost.Recorded,
      reviewer: Option[String],
      reviewed: Option[UblogPost.Recorded],
      publishedAt: Option[Instant]
  ):
    def needsReview(post: UblogPost) = sourceRevision != UblogTranslation.sourceRevision(post)
    def preview = PreviewContent(title, intro, imageAlt, imageCredit, updated, publishedAt)

  case class PreviewContent(
      title: String,
      intro: String,
      imageAlt: Option[String],
      imageCredit: Option[String],
      updated: UblogPost.Recorded,
      publishedAt: Option[Instant]
  )
  case class Preview(language: String, published: Option[PreviewContent])

  /** A rendering view; the persisted source and shared identity are never overwritten. */
  case class Edition(post: UblogPost, language: String, revision: Option[Revision]):
    def title = revision.fold(post.title)(_.title)
    def intro = revision.fold(post.intro)(_.intro)
    def markdown = revision.fold(post.markdown)(_.markdown)
    def image = post.image.map: image =>
      revision.fold(image)(r => image.copy(alt = r.imageAlt, credit = r.imageCredit))
    def isSource = revision.isEmpty
    def isPublished = post.live && (isSource || revision.exists(_.publishedAt.isDefined))
    def needsReview = revision.exists(_.needsReview(post))
    def url = urlOf(post, language)

  def source(post: UblogPost) = Edition(post, normalize(post.language.value), None)

  def select(post: UblogPost, language: String, draft: Boolean = false): Option[Edition] =
    if language == normalize(post.language.value) then Some(source(post))
    else
      post.translations
        .find(_.language == language)
        .flatMap(t => if draft then t.draft.orElse(t.published) else t.published)
        .map(r => Edition(post, language, Some(r)))

  def urlOf(post: UblogPost.BasePost, language: String): play.api.mvc.Call =
    if language == normalize(post.language.value) then routes.Ublog.post(post.created.by, post.slug, post.id)
    else routes.Ublog.edition(post.created.by, post.slug, post.id, language)

  def available(post: UblogPost.BasePost): List[String] =
    normalize(post.language.value) :: post.translationPreviews.filter(_.published.isDefined).map(_.language)

  def preferred(post: UblogPost.BasePost, language: String): String =
    available(post).find(_ == normalize(language)).getOrElse(normalize(post.language.value))
