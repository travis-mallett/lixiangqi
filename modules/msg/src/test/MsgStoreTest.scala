package lila.msg

import scala.concurrent.Await
import reactivemongo.api.AsyncDriver
import lila.db.dsl.{ *, given }

class MsgStoreTest extends munit.FunSuite:
  import BsonHandlers.given
  if sys.env.contains("LIXIANGQI_MSG_TEST_URI") then
    test("participant isolation, immutable receipts, revision races and recoverable deletion"):
      given Executor = scala.concurrent.ExecutionContext.global
      def waitFor[A](f: Fu[A]): A = Await.result(f, 30.seconds)
      val driver = new AsyncDriver()
      val connection = waitFor(driver.connect(sys.env("LIXIANGQI_MSG_TEST_URI")))
      val db =
        waitFor(connection.database("inbox_test_" + java.util.UUID.randomUUID().toString.replace("-", "")))
      val msgs = db.collection[Coll]("msg_msg")
      val threads = db.collection[Coll]("msg_thread")
      val store = MsgStore(msgs, threads)
      val alice = UserId("alice")
      val bob = UserId("bob")
      val eve = UserId("eve")
      val now = java.time.Instant.parse("2026-11-17T12:00:00Z")
      val original = Msg("original", alice, now, id = "test-message")
      val tid = MsgThread.id(alice, bob)
      try
        waitFor(msgs.insert.one(BsonHandlers.writeMsg(original, tid)))
        waitFor(
          threads.insert.one(BsonHandlers.writeThread(MsgThread.make(alice, bob, original, None, None), Nil))
        )
        assertEquals(waitFor(store.acknowledge(eve, alice, List(original.id), true, now)), Nil)
        assertEquals(waitFor(store.acknowledge(alice, bob, List(original.id), true, now)), Nil)
        val delivered =
          waitFor(store.acknowledge(bob, alice, List(original.id), false, now.plusSeconds(1))).head
        assertEquals(delivered.readAt, None)
        val read = waitFor(store.acknowledge(bob, alice, List(original.id), true, now.plusSeconds(2))).head
        assertEquals(read.deliveredAt, Some(now.plusSeconds(1)))
        assertEquals(read.readAt, Some(now.plusSeconds(2)))
        val again = waitFor(store.acknowledge(bob, alice, List(original.id), true, now.plusSeconds(3))).head
        assertEquals(again.readAt, read.readAt)
        assert(waitFor(store.markThreadRead(bob, alice, List(read))))
        val newer = original.copy(id = "newer", date = now.plusSeconds(5))
        waitFor(threads.update.one($id(tid), $set("lastMsg" -> newer.asLast)))
        waitFor(threads.update.one($id(tid), $set(s"preview.$bob" -> original.asLast)))
        assert(!waitFor(store.markThreadRead(bob, alice, List(read))))
        assert(waitFor(threads.byId[MsgThread](tid)).get.preview(bob.value).read)
        waitFor(threads.update.one($id(tid), $set("lastMsg" -> original.asLast.copy(id = None))))
        assert(waitFor(store.markThreadRead(bob, alice, List(read))))
        val edited = original.copy(
          text = "edited",
          revision = 1,
          editedAt = Some(now),
          history = List(Msg.Version(original.text, original.date))
        )
        assert(!waitFor(store.save(eve, alice, original, edited, false)))
        val raced = waitFor(
          scala.concurrent.Future.sequence(
            List(
              store.save(alice, bob, original, edited, false),
              store.save(alice, bob, original, edited.copy(text = "other edit"), false)
            )
          )
        )
        assertEquals(raced.count(identity), 1)
        val saved = waitFor(msgs.byId[Msg](original.id)).get
        assertEquals(saved.readAt, read.readAt)
        assertEquals(
          waitFor(store.acknowledge(bob, alice, List(original.id), true, now.plusSeconds(8))).head.readAt,
          read.readAt
        )
        val deleted = saved.copy(deletedAt = Some(now), revision = 2)
        assert(waitFor(store.save(alice, bob, saved, deleted, false)))
        val retained = waitFor(msgs.byId[Msg](original.id)).get
        assertEquals(retained.text, saved.text)
        assertEquals(retained.history, saved.history)
        assert(waitFor(store.save(bob, alice, retained, retained, true)))
        assertEquals(waitFor(msgs.one[Msg](store.visible(bob, alice) ++ $id(original.id))), None)
        assert(waitFor(msgs.one[Msg](store.visible(alice, bob) ++ $id(original.id))).isDefined)
      finally
        waitFor(db.drop())
        waitFor(driver.close())
