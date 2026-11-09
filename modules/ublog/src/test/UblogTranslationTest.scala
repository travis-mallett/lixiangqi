package lila.ublog

import scalalib.model.Language
import reactivemongo.api.bson.*

class UblogTranslationTest extends munit.FunSuite:
  import UblogBsonHandlers.given
  private val recorded =
    UblogPost.Recorded(UserId("writer"), nowInstant.truncatedTo(java.time.temporal.ChronoUnit.MILLIS))
  private val source = UblogPost(
    id = UblogPostId("abcdefgh"),
    blog = UblogBlog.Id.User(recorded.by),
    title = "Original article",
    intro = "Introduction",
    markdown = Markdown("English body"),
    language = Language("en"),
    image = None,
    topics = Nil,
    live = true,
    discuss = Some(true),
    sticky = None,
    ads = None,
    created = recorded,
    updated = None,
    lived = Some(recorded),
    featured = None,
    likes = UblogPost.Likes(7),
    views = UblogPost.Views(19),
    similar = None,
    automod = None,
    official = Some(true)
  )
  private val chinese = UblogTranslation.Revision(
    "象棋文章",
    "中文简介",
    Markdown("中文正文"),
    Some("棋盘"),
    None,
    UblogTranslation.sourceRevision(source),
    "AI translator",
    recorded,
    Some("AI editorial review"),
    Some(recorded),
    Some(recorded.at)
  )
  private val post = source.copy(translations =
    List(
      UblogTranslation(
        "zh-Hans",
        Some(chinese.copy(title = "Unpublished draft", publishedAt = None)),
        Some(chinese)
      ),
      UblogTranslation("vi", Some(chinese.copy(title = "Bản nháp", publishedAt = None)), None)
    )
  )

  test("public selection returns published content while an independent draft exists"):
    val edition = UblogTranslation.select(post, "zh-Hans").get
    assertEquals(edition.title, "象棋文章")
    assertEquals(edition.markdown.value, "中文正文")
    assertEquals(edition.post.id, source.id)
    assertEquals(edition.post.likes, source.likes)
    assertEquals(edition.post.lived, source.lived)
    assertEquals(edition.post.discuss, source.discuss)
    assertEquals(UblogTranslation.select(post, "zh-Hans", draft = true).get.title, "Unpublished draft")

  test("sitemap includes published editions and reciprocal links but excludes translation drafts"):
    val doc = summon[BSONDocumentWriter[UblogPost]].writeTry(post).get
    val preview = summon[BSONDocumentReader[UblogPost.PreviewPost]].readDocument(doc).get
    val xml = UblogSitemap.render(List(preview), "https://example.org")
    assertEquals("<loc>".r.findAllIn(xml).length, 2)
    assertEquals("hreflang=\"en\"".r.findAllIn(xml).length, 2)
    assertEquals("hreflang=\"zh-Hans\"".r.findAllIn(xml).length, 2)
    assert(!xml.contains("hreflang=\"vi\""))
    assert(!xml.contains("Unpublished draft"))
    assert(xml.contains("/zh-Hans</loc>"))
    assert(xml.contains("<lastmod>"))

  test("drafts and missing languages are never public fallback editions"):
    assertEquals(UblogTranslation.select(post, "vi"), None)
    assertEquals(UblogTranslation.select(post, "fr"), None)
    assertEquals(UblogTranslation.available(post), List("en", "zh-Hans"))
    assertEquals(UblogTranslation.preferred(post, "vi-VN"), "en")
    assertEquals(UblogTranslation.preferred(post, "zh-CN"), "zh-Hans")

  test("source revision includes editorial and image changes but excludes shared engagement"):
    assert(!chinese.needsReview(post))
    assert(chinese.needsReview(post.copy(markdown = Markdown("Changed"))))
    assert(chinese.needsReview(post.copy(title = "Changed")))
    assert(
      chinese.needsReview(post.copy(image = Some(UblogImage(lila.core.id.ImageId("cover"), Some("Changed")))))
    )
    assert(!chinese.needsReview(post.copy(likes = UblogPost.Likes(42), views = UblogPost.Views(50))))

  test("originals are not constrained to English"):
    val vietnamese = source.copy(language = Language("vi"), translations = Nil)
    assertEquals(UblogTranslation.source(vietnamese).language, "vi")
    assertEquals(UblogTranslation.available(vietnamese), List("vi"))
    assertEquals(UblogTranslation.preferred(vietnamese, "en"), "vi")

  test("a private source makes every edition unpublished"):
    val privatePost = post.copy(live = false)
    assert(!UblogTranslation.select(privatePost, "zh-Hans").get.isPublished)
    assert(!privatePost.canView(using None))
    assert(!privatePost.visibleByCrawlers)

  test("BSON roundtrip preserves published and draft revisions and one logical preview"):
    val doc = summon[BSONDocumentWriter[UblogPost]].writeTry(post).get
    assertEquals(summon[BSONDocumentReader[UblogPost]].readDocument(doc).get, post)
    val preview = summon[BSONDocumentReader[UblogPost.PreviewPost]].readDocument(doc).get
    val localized = preview.forLanguage("zh-CN")
    assertEquals(localized.id, post.id)
    assertEquals(localized.slug, post.slug)
    assertEquals(localized.title, "象棋文章")
    assertEquals(preview.forLanguage("vi").title, post.title)
    assertEquals(UblogTranslation.available(preview), List("en", "zh-Hans"))

  test("an explicit edition selection does not involve reader preferences"):
    for preference <- List("en", "vi", "zh-Hans", "fr") do
      assertEquals(post.forLanguage(preference).id, post.id)
      assertEquals(UblogTranslation.select(post, "zh-Hans").get.markdown.value, "中文正文")
      assertEquals(UblogTranslation.source(post).markdown.value, "English body")

  test("moderation includes every published edition within the shared text budget"):
    val longSource = post.copy(markdown = Markdown("a" * 100000))
    assert(longSource.moderationText.contains("中文正文"))
    assert(!longSource.moderationText.contains("Unpublished draft"))
    assert(longSource.moderationText.length <= 40001)

  test("Chinese search uses indexed adjacent pairs and respects run boundaries"):
    assertEquals(
      UblogSearch.cjkTerms("基本杀法。象棋"),
      "基 本 杀 法 cjkboundary 基本 本杀 杀法 cjkboundary 象 棋 cjkboundary 象棋 cjkboundary"
    )
    assertEquals(UblogSearch.query("基本杀法"), "\"基本 本杀 杀法\"")
    assertEquals(UblogSearch.query("马"), "\"马\"")
    assertEquals(UblogSearch.query("cờ tướng"), "cờ tướng")
