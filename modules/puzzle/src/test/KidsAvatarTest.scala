package lila.puzzle

import scala.concurrent.Await
import reactivemongo.api.AsyncDriver
import play.api.libs.json.*

import lila.db.AsyncColl
import lila.db.dsl.*
import lila.core.config.CollName

class KidsAvatarTest extends munit.FunSuite:
  import KidsAvatar.*
  test("catalog has valid free defaults and independent identity palettes"):
    assert(KidsAvatarCatalog.validAppearance(KidsAvatarCatalog.defaultAppearance, Set.empty))
    assertEquals(KidsAvatarCatalog.items.size, 62)
    assertEquals(KidsAvatarCatalog.defaults.size, 9)
    assert(KidsAvatarCatalog.palettes("skin").size >= 6)
    assert(
      !KidsAvatarCatalog.validAppearance(
        KidsAvatarCatalog.defaultAppearance.updated("hair", "prop_piece"),
        Set.empty
      )
    )
    assert(
      !KidsAvatarCatalog.validAppearance(
        KidsAvatarCatalog.defaultAppearance.updated("top", "top_lotus"),
        Set.empty
      )
    )
    assert(
      !KidsAvatarCatalog.validAppearance(
        KidsAvatarCatalog.defaultAppearance.updated("skinColor", "#invalid"),
        Set.empty
      )
    )

  test("smiles are independent free choices and older clients preserve the saved smile"):
    val original = KidsAvatarCatalog.defaultAppearance.updated("eyes", "eyes_calm")
    val legacy = original - "smile"
    assertEquals(KidsAvatarCatalog.addMissingSmile(legacy), original)
    assertEquals(KidsAvatarCatalog.addMissingSmile(legacy, "smile_giggle")("smile"), "smile_giggle")
    val choices = KidsAvatarCatalog.items.values.filter(_.category == "smile").toList
    assertEquals(choices.size, 6)
    choices.foreach: item =>
      assert(item.free)
      val selected = original.updated("smile", item.id)
      assert(KidsAvatarCatalog.validAppearance(selected, Set.empty))
      assertEquals(KidsAvatarCatalog.addMissingSmile(selected), selected)
    assert(!KidsAvatarCatalog.validAppearance(original.updated("smile", "eyes_calm"), Set.empty))
    assert(!KidsAvatarCatalog.validAppearance(original.updated("smile", "unknown"), Set.empty))
    assert(!KidsAvatarCatalog.validAppearance(KidsAvatarCatalog.addMissingSmile(legacy - "top"), Set.empty))

  test("progress gates, available funds, ownership and request reuse are independent"):
    assertEquals(purchaseState(14, State(), "top_lotus", "request_000000001", 1), Left("locked"))
    val bought = purchaseState(15, State(), "top_lotus", "request_000000001", 1).toOption.get
    assertEquals(bought.spentIngots, 4L)
    assertEquals(bought.appearance("top"), "top_lotus")
    assertEquals(purchaseState(15, bought, "top_lotus", "request_000000001", 1), Right(bought))
    assertEquals(purchaseState(15, bought, "top_lotus", "request_000000002", 1), Right(bought))
    assertEquals(purchaseState(15, bought, "hat_tiger", "request_000000001", 1), Left("request_reused"))
    assertEquals(purchaseState(15, bought, "hat_tiger", "request_000000002", 1), Left("insufficient_funds"))
    assertEquals(purchaseState(15, State(), "top_lotus", "request_000000001", 2), Left("catalog_changed"))

  test("spending coins preserves earned progress and ingot milestones"):
    val bought = purchaseState(15, State(), "top_bamboo", "request_000000001", 1).toOption.get
    val result = wallet(15, bought)
    assertEquals((result \ "earnedCoins").as[Int], 15)
    assertEquals((result \ "coins").as[Int], 9)
    assertEquals((result \ "ingots").as[Int], 6)

  if sys.env.contains("LIXIANGQI_REWARDS_TEST_URI") then
    test("Mongo atomically debits and grants across retries, concurrent devices and restarts"):
      given Executor = scala.concurrent.ExecutionContext.global
      val driver = new AsyncDriver()
      def waitFor[A](f: Fu[A]): A = Await.result(f, 45.seconds)
      val connection = waitFor(driver.connect(sys.env("LIXIANGQI_REWARDS_TEST_URI")))
      val database = waitFor(
        connection.database("kids_avatar_test_" + java.util.UUID.randomUUID().toString.replace("-", ""))
      )
      def coll(name: String) = new AsyncColl(CollName(name), () => fuccess(database.collection[Coll](name)))
      val rewards = new KidsRewards(coll("receipts"), _ => fuccess(true))
      def service = new KidsAvatar(coll("avatars"), rewards)
      val user = UserId("avatar-kid")
      try
        val rounds = (1 to 15).toList.map(n =>
          PuzzleRound(
            PuzzleRound.Id(user, PuzzleId(s"p$n")),
            PuzzleWin(true),
            None,
            nowInstant
          )
        )
        waitFor(rewards.award(user, rounds))
        val initial = waitFor(service.get(user))
        assertEquals((initial \ "rewards" \ "earnedCoins").as[Int], 15)
        val concurrent = waitFor(
          Future.sequence(
            List(
              service.purchase(user, "top_lotus", "request_000000001", 1),
              service.purchase(user, "hat_tiger", "request_000000002", 1)
            )
          )
        )
        assertEquals(concurrent.count(_.isRight), 1)
        assertEquals(concurrent.count(_ == Left("insufficient_funds")), 1)
        val winner = if concurrent.head.isRight then ("top_lotus", "request_000000001")
        else ("hat_tiger", "request_000000002")
        waitFor(Future.sequence(List.fill(12)(service.purchase(user, winner._1, winner._2, 1))))
        val saved = waitFor(service.get(user))
        assertEquals((saved \ "owned").as[List[String]], List(winner._1))
        assertEquals((saved \ "rewards" \ "ingots").as[Int], 2)
        assertEquals((saved \ "revision").as[Int], 1)
        assertEquals((waitFor(service.get(UserId("other-kid"))) \ "owned").as[List[String]], Nil)
        val appearance = (saved \ "appearance").as[Map[String, String]].updated("hair", "hair_long")
        assert(waitFor(service.equip(user, 1, appearance)).isRight)
        assertEquals(
          waitFor(service.equip(user, 1, appearance.updated("hair", "hair_crop"))),
          Left("conflict")
        )
        assertEquals(
          waitFor(service.equip(user, 2, appearance.updated("prop", "prop_kite"))),
          Left("invalid_appearance")
        )
        assertEquals((waitFor(service.get(user)) \ "appearance" \ "hair").as[String], "hair_long")
      finally
        waitFor(database.drop())
        waitFor(driver.close())
