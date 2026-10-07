package lila.security

class MobileEmailCodeTest extends munit.FunSuite:
  given Executor = scala.concurrent.ExecutionContext.global
  private val email = EmailAddress("player@example.com")

  test("a code is bound to email and purpose and consumed once"):
    val store = MobileEmailChallenges()
    val (id, code) = store.create(email, "register")
    assert(!store.consume(id, code, EmailAddress("other@example.com"), "register"))
    assert(!store.consume(id, code, email, "confirm:user"))
    assert(store.consume(id, code, email, "register"))
    assert(!store.consume(id, code, email, "register"))

  test("five incorrect attempts exhaust a challenge"):
    val store = MobileEmailChallenges()
    val (id, code) = store.create(email, "register")
    (1 to 5).foreach(_ => assert(!store.consume(id, "wrong", email, "register")))
    assert(!store.consume(id, code, email, "register"))

  test("expired and unknown challenges are rejected"):
    var time = 0L
    val store = MobileEmailChallenges(() => time)
    val (id, code) = store.create(email, "register")
    time = 600001L
    assert(!store.consume(id, code, email, "register"))
    assert(!store.consume("unknown", code, email, "register"))

  test("simultaneous verification has exactly one winner"):
    import scala.concurrent.{ Await, Future }
    given Executor = scala.concurrent.ExecutionContext.global
    val store = MobileEmailChallenges()
    val (id, code) = store.create(email, "register")
    val checks = Future.sequence((1 to 20).map(_ => Future(store.consume(id, code, email, "register"))))
    assertEquals(Await.result(checks, 5.seconds).count(identity), 1)
