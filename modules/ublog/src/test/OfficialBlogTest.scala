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

  test("official designation requires both ownership and the specific permission"):
    assert(!data.copy(official = true).canUpdateOfficial(draft)(using Me(author)))
    assert(data.copy(official = true).canUpdateOfficial(draft)(using Me(publisher)))
    assert(
      !data.copy(official = true).canUpdateOfficial(draft)(using Me(publisher.copy(id = UserId("other"))))
    )
    assert(
      !data.copy(official = true).canUpdateOfficial(draft)(using Me(publisher.copy(enabled = UserEnabled.No)))
    )

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
