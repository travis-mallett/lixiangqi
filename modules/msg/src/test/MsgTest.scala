package lila.msg

import lila.db.dsl.{ *, given }

class MsgTest extends munit.FunSuite:
  import BsonHandlers.given
  private val alice = UserId("alice")
  private val bob = UserId("bob")
  private val now = java.time.Instant.parse("2026-11-17T12:00:00Z")
  private val msg = Msg("Original", alice, now.minusSeconds(60), id = "message")

  test("owners can delete even read messages within 24 hours; other users cannot"):
    val read = msg.copy(readAt = Some(now))
    assert(read.canDeleteForEveryone(alice, now))
    assert(!read.canDeleteForEveryone(bob, now))
    assert(!read.copy(date = now.minusSeconds(86401)).canDeleteForEveryone(alice, now))
    assert(!read.copy(deletedAt = Some(now)).canDeleteForEveryone(alice, now))

  test("editing is limited to ten versions and the same ownership and time window"):
    assert(msg.canEdit(alice, now))
    assert(!msg.canEdit(bob, now))
    assert(!msg.copy(history = List.fill(10)(Msg.Version("previous", now))).canEdit(alice, now))
    assert(!msg.copy(date = now.minusSeconds(86401)).canEdit(alice, now))

  test("legacy BSON retains its actual ID without inventing receipt timestamps"):
    val legacy = $doc("_id" -> "old-id", "text" -> "Hello", "user" -> alice, "date" -> now)
    val read = legacy.asOpt[Msg].get
    assertEquals(read.id, "old-id")
    assertEquals(read.deliveredAt, None)
    assertEquals(read.readAt, None)
    assertEquals(read.revision, 0)

  test("deletion retains original and edited content in BSON but not participant JSON"):
    given Executor = scala.concurrent.ExecutionContext.global
    val deleted = msg.copy(
      text = "Edited",
      history = List(Msg.Version("Original", msg.date)),
      editedAt = Some(now),
      deletedAt = Some(now),
      reactions = List(Msg.Reaction(bob, "❤️")),
      reply = Some(Msg.Quote("quoted", bob, "Quote"))
    )
    val stored = BsonHandlers.writeMsg(deleted, MsgThread.id(alice, bob))
    assertEquals(stored.asOpt[Msg], Some(deleted))
    val json = new MsgJson(null, lila.core.socket.IsOnline(_ => false)).renderMsg(deleted)
    assertEquals((json \ "text").as[String], "")
    assertEquals((json \ "history").as[List[play.api.libs.json.JsValue]], Nil)
    assertEquals((json \ "reactions").as[List[play.api.libs.json.JsValue]], Nil)
    assertEquals((json \ "reply").asOpt[play.api.libs.json.JsObject], None)
    List("Original", "Edited", "Quote").foreach(text => assert(!json.toString.contains(text)))

  test("reactions accept one emoji grapheme including family, tone, flags and keycaps"):
    List("", "❤️", "👍🏿", "👨‍👩‍👧‍👦", "🇻🇳", "1️⃣", "😮").foreach(e =>
      assert(MsgActions.validReaction(e), e)
    )
    List("hello", "<script>", "❤️👍", "\n", "x😮").foreach(e => assert(!MsgActions.validReaction(e), e))
