package lila.msg

import scala.concurrent.Await
import reactivemongo.api.AsyncDriver
import lila.db.dsl.{ *, given }
import lila.core.user.{ Count, KidMode, Plan, UserEnabled }

class GroupInboxTest extends munit.FunSuite:
  private val alice = UserId("alice")
  private val bob = UserId("bob")
  private val chen = UserId("chen")
  private val room = "~" + "a" * 32

  private def account(id: UserId) = Me(
    User(
      id = id,
      username = UserName(id.value),
      count = Count(0, 0, 0, 0, 0),
      enabled = UserEnabled.Yes,
      roles = Nil,
      playTime = None,
      title = None,
      createdAt = nowInstant,
      seenAt = None,
      kid = KidMode.No,
      lang = None,
      plan = Plan(0, false, false, None),
      hasEmail = true
    )
  )

  test("a group receipt represents every original recipient, while each recipient sees their own receipt"):
    val now = millisToInstant(nowInstant.toEpochMilli)
    val msg = Msg.make("study", alice, now).get
    val base = BsonHandlers.writeMsg(msg, MsgThread.Id(room)) ++ $doc("audience" -> List(alice, bob, chen))
    val partial =
      base ++ $doc("delivered" -> $doc("bob" -> now, "chen" -> now), "reads" -> $doc("bob" -> now))
    assertEquals(GroupMessages.message(partial, bob).readAt, Some(now))
    assertEquals(GroupMessages.message(partial, chen).readAt, None)
    assertEquals(GroupMessages.message(partial, alice).readAt, None)
    assertEquals(GroupMessages.message(partial, alice).deliveredAt, Some(now))
    val all = partial ++ $doc("reads" -> $doc("bob" -> now, "chen" -> now.plusSeconds(1)))
    assertEquals(GroupMessages.message(all, alice).readAt, Some(now.plusSeconds(1)))

  test("administrator changes require a member and preserve an administrator while anyone remains"):
    val g = MsgGroup(room, "Study", List(alice), List(alice, bob, chen), nowInstant, Map.empty)
    assertEquals(g.changeAdmin(UserId("outsider"), promote = true), None)
    assertEquals(g.changeAdmin(alice, promote = false), None)
    assertEquals(g.changeAdmin(bob, promote = true), Some(List(bob, alice)))
    assertEquals(g.copy(admins = List(alice, bob)).changeAdmin(alice, promote = false), Some(List(bob)))
    assertEquals(g.remainingAdmins(List(bob, chen)), List(bob))
    assertEquals(g.copy(admins = List(alice, chen)).remainingAdmins(List(bob, chen)), List(chen))
    assertEquals(g.remainingAdmins(Nil), Nil)

  test("mentions match whole usernames, case insensitively"):
    assertEquals(
      MsgGroups.mentions("@Alice, ask @Chen-2 and mail chess@example.com."),
      Set(alice, UserId("chen-2"))
    )

  test("archive, pins, folders and muted mentions belong to each individual group member"):
    assume(sys.env.contains("LIXIANGQI_MEDIA_REPLICA_URI"))
    given Executor = scala.concurrent.ExecutionContext.global
    given lila.core.config.RateLimit = lila.core.config.RateLimit.No
    def await[A](f: Fu[A]) = Await.result(f, 30.seconds)
    val driver = new AsyncDriver()
    val db = lila.db.Db(
      "inbox",
      sys
        .env("LIXIANGQI_MEDIA_REPLICA_URI")
        .stripSuffix("/") + "/inbox_group_test_" + java.util.UUID.randomUUID().toString.replace("-", ""),
      driver
    )
    val colls = MsgColls(db)
    val org = MsgOrganization(colls)
    val a = account(alice)
    val b = account(bob)
    val at = nowInstant
    try
      await(colls.group.insert.one($id(room) ++ $doc("users" -> List(alice, bob))))
      for setting <- List("archive", "pin", "unread", "mute") do
        await(org.update(room, setting, "true", Nil)(using a))
      assertEquals(await(org.selected("archive")(using a)), List(room))
      assertEquals(await(org.selected("archive")(using b)), Nil)
      assert(await(org.muted(alice, room)))
      assert(!await(org.muted(alice, room, mentioned = true)))
      await(org.update(room, "mentions", "false", Nil)(using a))
      assert(await(org.muted(alice, room, mentioned = true)))
      val created = await(org.update("", "folder", "League", List(room))(using a))
      val folder = (created \ "folders")(0)("id").as[String]
      assertEquals(await(org.selected("folder/" + folder)(using a)), List(room))
      assertEquals(await(org.selected("folder/" + folder)(using b)), Nil)
      intercept[MsgActionError](await(org.update(room, "pin", "true", Nil)(using account(chen))))
      val message = Msg.make("opening", alice, at).get
      await(
        colls.msg.insert.one(
          BsonHandlers.writeMsg(message, MsgThread.Id(room)) ++ $doc("audience" -> List(alice, bob))
        )
      )
      assert(await(colls.msg.exists(GroupMessages.visible(room, bob))))
      assert(!await(colls.msg.exists(GroupMessages.visible(room, chen))))
      await(colls.group.update.one($id(room), $addToSet("users" -> chen)))
      assert(!await(colls.msg.exists(GroupMessages.visible(room, chen))))
      await(colls.msg.update.one($id(message.id), $addToSet("del" -> bob)))
      assert(!await(colls.msg.exists(GroupMessages.visible(room, bob))))
      assert(await(colls.msg.exists(GroupMessages.visible(room, alice))))
    finally
      await(colls.group.db.drop())
      await(driver.close())
