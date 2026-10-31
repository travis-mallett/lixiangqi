package lila.forum

import lila.core.perm.Permission
import lila.core.user.{ Count, KidMode, Plan, UserEnabled }

class ForumAccessTest extends munit.FunSuite:
  given Executor = scala.concurrent.ExecutionContext.global

  // Public boards do not consult either service. A mistaken team lookup must fail this test.
  private val access = new ForumAccess(null, null)
  private val board = ForumCateg.publicBoards.head.id
  private val newcomer = User(
    UserId("newcomer"),
    UserName("Newcomer"),
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

  private def canWrite(user: User) = access.isGrantedWrite(board)(using Some(Me(user)))

  test("a newly appointed forum moderator can create topics without games"):
    canWrite(newcomer.copy(roles = List(Permission.ModerateForum.dbKey))).map(assert(_))

  test("ordinary new accounts still need the anti-spam qualification"):
    canWrite(newcomer).map(granted => assert(!granted))

  test("unrelated moderation permissions do not bypass the posting requirement"):
    canWrite(newcomer.copy(roles = List(Permission.MarkEngine.dbKey))).map(granted => assert(!granted))

  test("established players can still post"):
    canWrite(newcomer.copy(createdAt = nowInstant.minusDays(3), count = Count(0, 1, 0, 0, 1)))
      .map(assert(_))

  test("anonymous visitors cannot post"):
    access.isGrantedWrite(board)(using None).map(granted => assert(!granted))

  test("bots cannot post even with forum moderation permission"):
    canWrite(newcomer.copy(roles = List(Permission.ModerateForum.dbKey), title = Some(chess.PlayerTitle.BOT)))
      .map(granted => assert(!granted))

  test("disabled moderator permissions do not bypass the posting requirement"):
    canWrite(newcomer.copy(roles = List(Permission.ModerateForum.dbKey), enabled = UserEnabled.No))
      .map(granted => assert(!granted))
