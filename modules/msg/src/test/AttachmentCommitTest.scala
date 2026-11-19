package lila.msg

import scala.concurrent.Await
import reactivemongo.api.AsyncDriver
import reactivemongo.api.bson.{ BSONBinary, Subtype }
import play.api.Configuration
import lila.core.config.CollName
import lila.core.security.SubmissionRejected
import lila.db.dsl.{ *, given }
import lila.memo.Attachment

class AttachmentCommitTest extends munit.FunSuite:
  test("a failed publication rolls back its reservation and either Kid participant blocks the commit"):
    assume(sys.env.contains("LIXIANGQI_MEDIA_REPLICA_URI"))
    given Executor = scala.concurrent.ExecutionContext.global
    def await[A](f: Fu[A]) = Await.result(f, 30.seconds)
    val driver = new AsyncDriver()
    val dbName = "attachment_test_" + java.util.UUID.randomUUID().toString.replace("-", "")
    val db =
      lila.db.Db("media-test", sys.env("LIXIANGQI_MEDIA_REPLICA_URI").stripSuffix("/") + "/" + dbName, driver)
    val users = db(CollName("user4"))
    val col = db(CollName("ugc_attachment"))
    val records = lila.memo.Attachments(
      db,
      Configuration(
        "attachments.msg" -> true,
        "attachments.forum" -> false,
        "attachments.maxCount" -> 4,
        "attachments.inboxMaxCount" -> 8,
        "attachments.maxBytes" -> 4194304,
        "attachments.hourlyUploads" -> 20
      )
    )
    val alice = UserId("alice")
    val bob = UserId("bob")
    val id = "ab" * 16
    val bytes = "hello".getBytes(java.nio.charset.StandardCharsets.UTF_8)
    val contacts = ContactApi(users)
    def commit(body: => Funit): Funit = records.transaction { tx =>
      contacts.guardMedia(tx, List(alice, bob)) >> records.prepare(
        alice,
        "msg/bob",
        "parent",
        0,
        List(id),
        transaction = Some(tx)
      ) >> body
    }
    try
      List(alice, bob).foreach(id =>
        await(users.insert.one($id(id) ++ $doc("enabled" -> true, "createdAt" -> nowInstant)))
      )
      await(
        col.insert.one(
          $id(id) ++ $doc(
            "name" -> "n.txt",
            "owner" -> alice,
            "size" -> bytes.length,
            "audience" -> "msg/bob",
            "state" -> "ready",
            "policy" -> Attachment.policy,
            "digest" -> Attachment.sha(bytes),
            "mime" -> "text/plain",
            "bytes" -> BSONBinary(bytes, Subtype.GenericBinarySubtype)
          )
        )
      )
      assert(!records.enabled("chat"))
      assertEquals(records.maxCount("msg"), 8)
      assertEquals(records.maxCount("forum"), 4)
      val album = (1 to 8).map(i => f"$i%032x").toList
      val ready = await(col.byIdProj[Bdoc](id, $doc("_id" -> false))).get
      album.foreach(photo => await(col.insert.one(ready ++ $id(photo))))
      intercept[SubmissionRejected](await(records.prepare(alice, "msg/bob", "album", 0, album :+ id)))
      await(records.prepare(alice, "msg/bob", "album", 0, album))
      assertEquals(await(col.countSel($doc("parent" -> "album"))), 8)
      intercept[SubmissionRejected](await(records.prepare(bob, "msg/alice", "other", 0, List(id))))
      intercept[SubmissionRejected](await(records.prepare(alice, "msg/bob", "parent", 0, List(id, id))))
      for kid <- List(alice, bob) do
        await(users.update.one($id(kid), $set("kid" -> true)))
        intercept[SubmissionRejected](await(commit(funit)))
        assert(await(records.get(id)).flatMap(_.parent).isEmpty)
        await(users.update.one($id(kid), $set("kid" -> false)))
      intercept[SubmissionRejected](await(commit(fufail(SubmissionRejected("conflict")))))
      assert(await(records.get(id)).flatMap(_.parent).isEmpty)
      await(commit(funit))
      assertEquals(await(records.get(id)).flatMap(_.parent), Some("parent"))
      val messages = db(CollName("msg_msg"))
      val store = MsgStore(messages, db(CollName("msg_thread")))
      def readable(viewer: UserId) = await(
        store.canReadAttachment(viewer, alice, bob, "parent", id)(
          contacts.contacts(alice, bob).map(_.exists(_.activeAdults))
        )
      )
      assert(!readable(bob))
      await(
        messages.insert.one(
          $id("parent") ++ $doc("tid" -> MsgThread.id(alice, bob), "user" -> alice, "attachments" -> List(id))
        )
      )
      assert(readable(alice) && readable(bob) && !readable(UserId("other")))
      for kid <- List(alice, bob) do
        await(users.update.one($id(kid), $set("kid" -> true)))
        assert(!readable(alice) && !readable(bob))
        await(users.update.one($id(kid), $set("kid" -> false)))
      await(messages.update.one($id("parent"), $set("del" -> List(bob))))
      assert(!readable(bob) && readable(alice))
      await(messages.update.one($id("parent"), $set("attachments" -> List.empty[String])))
      assert(!readable(alice))
      await(
        col.update.one($id(id), $set("bytes" -> BSONBinary(Array[Byte](1), Subtype.GenericBinarySubtype)))
      )
      assert(await(records.approvedBytes(await(records.get(id)).get)).isEmpty)
      intercept[SubmissionRejected](await(commit(funit)))
    finally
      await(users.db.drop())
      await(driver.close())
