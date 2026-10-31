package lila.user

import scala.concurrent.Await
import reactivemongo.api.AsyncDriver
import lila.core.security.HashedPassword
import lila.db.dsl.{ *, given }

class ExternalIdentityRepoTest extends munit.FunSuite:
  if sys.env.contains("LIXIANGQI_EXTERNAL_LOGIN_TEST_URI") then
    test("identity ownership and last-method protection are atomic under concurrency"):
      given Executor = scala.concurrent.ExecutionContext.global
      def waitFor[A](f: Fu[A]): A = Await.result(f, 30.seconds)
      val driver = new AsyncDriver()
      val connection = waitFor(driver.connect(sys.env("LIXIANGQI_EXTERNAL_LOGIN_TEST_URI")))
      val db = waitFor(
        connection.database("external_login_test_" + java.util.UUID.randomUUID().toString.replace("-", ""))
      )
      val users = UserRepo(db.collection("user"))
      val repo = ExternalIdentityRepo(users)
      def create(name: String, password: Boolean, identity: Option[String] = None) =
        waitFor(
          users.create(
            UserName(name),
            Option.when(password)(HashedPassword(Array.fill(39)(1.toByte))),
            EmailAddress(s"$name@example.org"),
            false,
            false,
            externalIdentity = identity
          )
        ).get
      try
        waitFor(repo.ready)
        val a = create("alice", true)
        assertEquals(waitFor(repo.hasPassword(a.id)), true)
        val b = create("bob", true)
        val claims =
          waitFor(Future.sequence(List(repo.link(a.id, "google:123"), repo.link(b.id, "google:123"))))
        assertEquals(claims.count(identity), 1)
        val owner = waitFor(repo.owner("google:123")).get
        assertEquals(waitFor(repo.link(owner.id, "google:456")), false)
        assertEquals(waitFor(repo.unlink(owner.id, "google:123")), true)
        // Removing a final link unsets the field; empty arrays must not collide in the unique index.
        assertEquals(waitFor(repo.link(a.id, "google:a")), true)
        assertEquals(waitFor(repo.link(b.id, "google:b")), true)
        assertEquals(waitFor(repo.unlink(a.id, "google:a")), true)
        assertEquals(waitFor(repo.unlink(b.id, "google:b")), true)
        val c = create("carol", false, Some("lichess:carol"))
        assertEquals(waitFor(repo.hasPassword(c.id)), false)
        assertEquals(waitFor(repo.link(c.id, "lishogi:carol")), true)
        val removals = waitFor(
          Future.sequence(List(repo.unlink(c.id, "lichess:carol"), repo.unlink(c.id, "lishogi:carol")))
        )
        assertEquals(removals.count(identity), 1)
        assertEquals(waitFor(repo.list(c.id)).size, 1)
        assertEquals(waitFor(users.getPasswordHash(c.id)), None)
        val key = waitFor(repo.list(c.id)).head
        intercept[Exception](create("collision", false, Some(key)))
        assertEquals(waitFor(users.byId(UserId("collision"))), None)
        assertEquals(waitFor(repo.owner(key)).map(_.id), Some(c.id))
      finally
        waitFor(db.drop())
        waitFor(driver.close())
