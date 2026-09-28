package lila.plan

import scala.concurrent.Await
import reactivemongo.api.{ AsyncDriver, DB }
import reactivemongo.api.bson.*
import lila.core.user.{ Plan, Count, UserEnabled, KidMode }
import lila.db.dsl.{ *, given }

class PayPalPaymentStoreTest extends munit.FunSuite:
  import BsonHandlers.PatronHandlers.given
  given BSONDocumentHandler[Plan] = new lila.db.BSON[Plan]:
    def reads(r: lila.db.BSON.Reader) =
      Plan(r.int("months"), r.bool("active"), r.bool("lifetime"), r.dateO("since"))
    def writes(w: lila.db.BSON.Writer, p: Plan) =
      $doc("months" -> p.months, "active" -> p.active, "lifetime" -> p.lifetime, "since" -> p.since)

  if sys.env.contains("LIXIANGQI_PAYPAL_TEST_URI") then
    test("atomic payments survive replay, concurrency, rollback and service restart"):
      given Executor = scala.concurrent.ExecutionContext.global
      val driver = new AsyncDriver()
      def waitFor[A](f: Fu[A]): A = Await.result(f, 30.seconds)
      val connection = waitFor(driver.connect(sys.env("LIXIANGQI_PAYPAL_TEST_URI")))
      val db =
        waitFor(connection.database("paypal_test_" + java.util.UUID.randomUUID().toString.replace("-", "")))
      val mongo = new PlanMongo(db.collection("patron"), db.collection("charge"))
      val users: Coll = db.collection("user")
      val empty = Plan(0, false, false, None)
      def user(id: UserId, plan: Plan) = User(
        id,
        UserName(id.value),
        Count(0, 0, 0, 0, 0),
        UserEnabled.Yes,
        Nil,
        playTime = None,
        createdAt = nowInstant,
        seenAt = None,
        kid = KidMode.No,
        lang = None,
        plan = plan,
        hasEmail = false
      )
      var fail = false
      def update(id: UserId, tx: DB)(f: Plan => Plan): Fu[(User, User)] =
        val coll: Coll = tx.collection("user")
        for
          previous <- coll.primitiveOne[Plan]($id(id), "plan")
          before = user(id, previous.getOrElse(empty))
          after = before.copy(plan = f(before.plan))
          _ <- coll.update.one($id(id), $set("plan" -> after.plan), upsert = true)
          _ <- if fail then fufail("simulated crash after user write") else funit
        yield before -> after
      def store = new PayPalPaymentStore(mongo, (id, tx) => f => update(id, tx)(f))
      val donor = UserId("donor")
      val checkout =
        Some(Patron.PayPalCheckout(None, PayPalPayerId("payer"), Some(PayPalSubscriptionId("I-TEST"))))
      val first = Charge(
        "paypal:first",
        Some(donor),
        payPalCheckout = checkout,
        money = Money(5, java.util.Currency.getInstance("USD")),
        usd = Usd(5),
        date = nowInstant.minusDays(30)
      )
      try
        // Collections must exist before a transaction on all supported Mongo versions.
        waitFor(mongo.patron.create())
        waitFor(mongo.charge.create())
        waitFor(users.create())
        assert(waitFor(store.commit(first, false)).isDefined)
        assertEquals(waitFor(store.commit(first, false)), None)
        val renewal = first.copy(
          _id = "paypal:renewal",
          date = nowInstant,
          money = first.money.copy(amount = 7),
          usd = Usd(7)
        )
        val outcomes = waitFor(Future.sequence(List.fill(6)(store.commit(renewal, false))))
        assertEquals(outcomes.count(_.isDefined), 1)
        assertEquals(waitFor(mongo.charge.countSel($empty)), 2)
        assertEquals(waitFor(users.primitiveOne[Plan]($id(donor), "plan")).map(_.months), Some(2))
        val expiry = waitFor(mongo.patron.one[Patron]($id(donor))).get.expiresAt
        assertEquals(waitFor(store.commit(first, false)), None)
        assertEquals(waitFor(mongo.patron.one[Patron]($id(donor))).get.expiresAt, expiry)
        fail = true
        val gift = renewal.copy(_id = "paypal:gift", giftTo = Some(UserId("recipient")))
        intercept[Exception](waitFor(store.commit(gift, false, attempts = 1)))
        assert(!waitFor(mongo.charge.exists($id(gift.id))))
        assert(!waitFor(mongo.patron.exists($id(UserId("recipient")))))
        assert(!waitFor(users.exists($id(UserId("recipient")))))
        fail = false
        assert(waitFor(store.commit(gift, true)).isDefined)
        assert(waitFor(users.primitiveOne[Plan]($id(UserId("recipient")), "plan")).get.lifetime)
        assertEquals(waitFor(store.commit(gift, true)), None)
      finally
        waitFor(db.drop())
        waitFor(driver.close())
