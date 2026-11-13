package lila.ublog

import reactivemongo.api.bson.Macros.Annotations.Key

import scalalib.model.Language
import lila.core.id.ImageId
import lila.core.ublog.Quality

case class UblogPost(
    @Key("_id") id: UblogPostId,
    blog: UblogBlog.Id,
    title: String,
    intro: String,
    markdown: Markdown,
    language: Language,
    image: Option[UblogImage],
    topics: List[UblogTopic],
    live: Boolean,
    discuss: Option[Boolean],
    sticky: Option[Boolean],
    ads: Option[Boolean], // boo!
    created: UblogPost.Recorded,
    updated: Option[UblogPost.Recorded],
    lived: Option[UblogPost.Recorded],
    featured: Option[UblogPost.Featured],
    likes: UblogPost.Likes,
    views: UblogPost.Views,
    similar: Option[List[UblogSimilar]],
    automod: Option[UblogAutomod.Assessment],
    official: Option[Boolean] = None,
    translations: List[UblogTranslation] = Nil
) extends UblogPost.BasePost
    with lila.core.ublog.UblogPost:

  def isBy[U: UserIdOf](u: U) = created.by.is(u)
  def isUserBlog[U: UserIdOf](u: U) = blog == UblogBlog.Id.User(u.id)

  def indexable = live && (
    topics.exists(UblogTopic.xiangqiExists) || featured.isDefined || isOfficial
  )
  def visibleByCrawlers = indexable && (isOfficial || automod.exists(_.quality != Quality.spam))
  private def editionTexts = s"$title $intro $markdown" :: translations
    .flatMap(_.published)
    .map(r => s"${r.title} ${r.intro} ${r.markdown}")
  def allText = editionTexts.mkString("\n")
  // Keep the existing request budget while giving every published language a share.
  def moderationText =
    val texts = editionTexts
    texts.map(_.take(40_000 / texts.size)).mkString("\n")

  def allows = UblogBlog.Allows(created.by, isOfficial)
  // Moderators may promote community posts; official content keeps its author-only edit policy.
  def canSetOfficial(using me: Me) =
    (isBy(me) && lila.core.perm.Granter(_.PublishOfficialBlog)) ||
      (!isOfficial && lila.core.perm.Granter(_.ModerateBlog))
  def canView(using Option[Me]) = live || allows.draft

  def translationPreviews = translations.map(_.preview)

case class UblogImage(id: ImageId, alt: Option[String] = None, credit: Option[String] = None)

case class UblogSimilar(id: UblogPostId, count: Int)

object UblogPost:

  export lila.core.ublog.UblogPost.*

  def slug(title: String) =
    val s = scalalib.StringOps.slug(title)
    if s.isEmpty then "-" else s

  opaque type Likes = Int
  object Likes extends RelaxedOpaqueInt[Likes]
  opaque type Views = Int
  object Views extends RelaxedOpaqueInt[Views]

  trait BasePost extends lila.core.ublog.UblogPost:
    val blog: UblogBlog.Id
    val title: String
    val intro: String
    val language: Language
    def translationPreviews: List[UblogTranslation.Preview]
    val image: Option[UblogImage]
    val created: Recorded
    val updated: Option[Recorded]
    val lived: Option[Recorded]
    val featured: Option[Featured]
    val sticky: Option[Boolean]
    def slug = UblogPost.slug(title)
    val official: Option[Boolean]
    def isOfficial = official.contains(true)
    def editionLanguage = UblogTranslation.normalize(language.value)
    def forLanguage(preferred: String): BasePost =
      translationPreviews
        .find(_.language == UblogTranslation.normalize(preferred))
        .flatMap(t => t.published.map(c => LocalizedPost(this, t.language, c)))
        .getOrElse(this)

  private case class LocalizedPost(
      source: BasePost,
      override val editionLanguage: String,
      content: UblogTranslation.PreviewContent
  ) extends BasePost:
    export source.{ id, blog, language, created, lived, featured, sticky, official, translationPreviews }
    val title = content.title
    val intro = content.intro
    val updated = Some(content.updated)
    val image = source.image.map(_.copy(alt = content.imageAlt, credit = content.imageCredit))
    override def slug = source.slug

  case class PreviewPost(
      @Key("_id") id: UblogPostId,
      blog: UblogBlog.Id,
      title: String,
      intro: String,
      image: Option[UblogImage],
      created: Recorded,
      updated: Option[Recorded],
      lived: Option[Recorded],
      featured: Option[Featured],
      sticky: Option[Boolean],
      topics: List[UblogTopic],
      official: Option[Boolean] = None,
      language: Language = Language("en"),
      translations: List[UblogTranslation.Preview] = Nil
  ) extends BasePost:
    def translationPreviews = translations

  case class Featured(by: UserId, at: Option[Instant], until: Option[Instant] = none)

  case class CarouselPosts(
      pinned: List[PreviewPost],
      queue: List[PreviewPost]
  ):
    def ordered: List[PreviewPost] =
      val (official, community) = (pinned ++ queue).distinctBy(_.id).partition(_.isOfficial)
      official.sortBy(p => p.lived.fold(p.created.at)(_.at))(using Ordering[Instant].reverse) ++ community

    def has(id: UblogPostId): Boolean =
      pinned.exists(_.id == id) || queue.exists(_.id == id)

  case class BlogPreview(nbPosts: Int, latests: List[PreviewPost])

  def randomId = UblogPostId(scalalib.ThreadLocalRandom.nextString(8))

  object thumbnail:
    enum Size(val width: Int):
      def height = width * 10 / 16
      def dimensions = lila.memo.Dimensions(width, height)
      case Large extends Size(880)
      case Small extends Size(400)
    type SizeSelector = thumbnail.type => Size

    def apply(picfitUrl: lila.memo.PicfitUrl, image: ImageId, size: SizeSelector): Url =
      picfitUrl.thumbnail(image)(size(thumbnail).dimensions)
