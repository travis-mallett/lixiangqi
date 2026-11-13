package lila.ublog

import lila.core.perm.{ Granter, Permission }
import lila.core.user.{ Count, KidMode, Plan, UserEnabled }

class OfficialBlogTest extends munit.FunSuite:
  private val author = User(
    UserId("author"),
    UserName("Author"),
    Count(0, 0, 0, 0, 0),
    UserEnabled.Yes,
    Nil,
    playTime = None,
    createdAt = nowInstant,
    seenAt = None,
    kid = KidMode.No,
    lang = None,
    plan = Plan(0, false, false, None),
    hasEmail = false
  )
  private val publisher = author.copy(roles = List(Permission.PublishOfficialBlog.dbKey))
  private val data = UblogForm.UblogPostData(
    title = "An update",
    intro = "Introduction",
    markdown = Markdown("Body"),
    imageAlt = None,
    imageCredit = None,
    language = None,
    topics = None,
    live = false,
    discuss = false,
    sticky = false,
    ads = false,
    official = false,
    gameId = GameId(""),
    move = ""
  )
  private val draft = data.create(author)
  private val official = draft.copy(official = Some(true), live = true)
  private def editAs(post: UblogPost, user: User) = post.allows.edit(using Some(Me(user)))

  test("official publishing grants no permission to edit another author's posts"):
    val other = publisher.copy(id = UserId("other"))
    assert(!editAs(draft, other))
    assert(!editAs(official, other))
    assert(!Granter.of(_.ModerateBlog)(publisher))
    assert(!Granter.of(_.PublishOfficialBlog)(author.copy(roles = List(Permission.ModerateBlog.dbKey))))

  test("even blog moderators and super admins cannot edit another author's official post"):
    for role <- List(Permission.ModerateBlog, Permission.Admin, Permission.SuperAdmin, Permission.Pages) do
      val other =
        author.copy(id = UserId("other"), roles = List(role.dbKey, Permission.PublishOfficialBlog.dbKey))
      assert(!editAs(official, other), role.toString)
    assert(editAs(official, author))
    assert(editAs(draft, author.copy(id = UserId("mod"), roles = List(Permission.ModerateBlog.dbKey))))

  test("authors need the publishing permission to designate their own posts as official"):
    assert(!data.copy(official = true).canUpdateOfficial(draft)(using Me(author)))
    assert(data.copy(official = true).canUpdateOfficial(draft)(using Me(publisher)))
    assert(
      !data.copy(official = true).canUpdateOfficial(draft)(using Me(publisher.copy(id = UserId("other"))))
    )
    assert(
      !data.copy(official = true).canUpdateOfficial(draft)(using Me(publisher.copy(enabled = UserEnabled.No)))
    )

  test("blog moderators can promote community posts without owning them or holding the publisher role"):
    for role <- List(Permission.ModerateBlog, Permission.Admin, Permission.SuperAdmin) do
      val moderator = author.copy(id = UserId("moderator"), roles = List(role.dbKey))
      for live <- List(false, true) do
        val community = draft.copy(live = live)
        assert(editAs(community, moderator), role.toString)
        assert(community.canSetOfficial(using Me(moderator)), role.toString)
        assert(data.copy(official = true, live = live).canUpdateOfficial(community)(using Me(moderator)))
        assert(!community.canSetOfficial(using Me(moderator.copy(enabled = UserEnabled.No))))

  test("promotion preserves the author, publication history, identity and translations"):
    val moderator = author.copy(id = UserId("moderator"), roles = List(Permission.ModerateBlog.dbKey))
    val publishedAt = UblogPost.Recorded(author.id, nowInstant.minusSeconds(86400))
    val translation = UblogTranslation.Revision(
      "Bài viết",
      "Giới thiệu",
      Markdown("Nội dung"),
      None,
      None,
      UblogTranslation.sourceRevision(draft),
      "Translator",
      publishedAt,
      Some("Reviewer"),
      Some(publishedAt),
      Some(publishedAt.at)
    )
    val community = draft.copy(
      live = true,
      lived = Some(publishedAt),
      translations = List(UblogTranslation("vi", None, Some(translation)))
    )
    val promoted = data.copy(official = true, live = true).update(moderator, community)
    assert(promoted.isOfficial)
    assert(promoted.visibleByCrawlers)
    assertEquals(promoted.created, community.created)
    assertEquals(promoted.blog, community.blog)
    assertEquals(promoted.id, community.id)
    assertEquals(promoted.slug, community.slug)
    assertEquals(promoted.lived, community.lived)
    assertEquals(promoted.translations, community.translations)
    assertEquals(UblogTranslation.select(promoted, "vi").map(_.title), Some("Bài viết"))
    assert(!translation.needsReview(promoted))
    assertEquals(promoted.updated.map(_.by), Some(moderator.id))

  test("promotion does not let moderators edit, demote or republish another author's official post"):
    val moderator = author.copy(id = UserId("moderator"), roles = List(Permission.ModerateBlog.dbKey))
    assert(!editAs(official, moderator))
    assert(!official.canSetOfficial(using Me(moderator)))
    assert(!data.canUpdateOfficial(official)(using Me(moderator)))
    assert(
      !data
        .copy(official = true, live = true)
        .canUpdateOfficial(official.copy(live = false))(using Me(moderator))
    )

  test("unrelated moderation roles do not grant community-post promotion"):
    for role <- List(Permission.ModerateForum, Permission.Pages, Permission.PublishOfficialBlog) do
      val other = author.copy(id = UserId("other"), roles = List(role.dbKey))
      assert(!draft.canSetOfficial(using Me(other)), role.toString)

  test("revocation preserves author edits but prevents publishing official drafts or changing designation"):
    assert(editAs(official, author))
    assert(data.copy(official = true, live = true).canUpdateOfficial(official)(using Me(author)))
    assert(
      !data
        .copy(official = true, live = true)
        .canUpdateOfficial(official.copy(live = false))(using Me(author))
    )
    assert(!data.canUpdateOfficial(official)(using Me(author)))
    assert(data.canUpdateOfficial(official)(using Me(publisher)))

  test("creating a draft cannot forge an official designation"):
    val created = data.copy(official = true, live = true).create(author)
    assert(!created.isOfficial)
    assert(!created.live)

  test("stored old posts remain readable, and previews retain official status"):
    import UblogBsonHandlers.given
    import reactivemongo.api.bson.*
    val doc = summon[BSONDocumentWriter[UblogPost]].writeTry(official).get
    assert(summon[BSONDocumentReader[UblogPost.PreviewPost]].readDocument(doc).get.isOfficial)
    assert(!summon[BSONDocumentReader[UblogPost]].readDocument(doc -- "official").get.isOfficial)

  test("official live posts are indexable without automated community quality scoring"):
    assert(official.visibleByCrawlers)
    assert(!official.copy(live = false).visibleByCrawlers)

  test("carousel puts official posts first by publication date and removes pinned queue duplicates"):
    import UblogBsonHandlers.given
    import reactivemongo.api.bson.*
    def preview(id: String, daysAgo: Int, isOfficial: Boolean) =
      val post = official.copy(
        id = UblogPostId(id),
        lived = Some(UblogPost.Recorded(author.id, nowInstant.minusSeconds(daysAgo * 86400L))),
        official = Some(isOfficial)
      )
      val doc = summon[BSONDocumentWriter[UblogPost]].writeTry(post).get
      summon[BSONDocumentReader[UblogPost.PreviewPost]].readDocument(doc).get

    val older = preview("olderPost", 10, true)
    val newer = preview("newerPost", 1, true)
    val pinnedCommunity = preview("pinnedCo", 0, false)
    val community = preview("queuedCo", 0, false)
    val posts = UblogPost.CarouselPosts(
      List(pinnedCommunity, older),
      List(community, older, newer)
    )
    assertEquals(posts.ordered, List(newer, older, pinnedCommunity, community))
    assertEquals(UblogPost.CarouselPosts(Nil, Nil).ordered, Nil)
