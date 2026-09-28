package lila.plan

import play.api.libs.json.*

class PayPalJsonTest extends munit.FunSuite:
  import JsonHandlers.payPal.given

  private val capture = Json.obj(
    "id" -> "CAPTURE-1",
    "status" -> "COMPLETED",
    "create_time" -> "2026-09-22T12:00:00Z",
    "amount" -> Json.obj("value" -> "5.00", "currency_code" -> "USD")
  )
  private def order(payment: JsObject) = Json.obj(
    "id" -> "ORDER-1",
    "status" -> "COMPLETED",
    "intent" -> "CAPTURE",
    "payer" -> Json.obj("payer_id" -> "PAYER-1"),
    "purchase_units" -> Json.arr(
      Json.obj(
        "custom_id" -> "donor recipient",
        "amount" -> Json.obj("value" -> "10.00", "currency_code" -> "USD"),
        "payments" -> Json.obj("captures" -> Json.arr(payment))
      )
    )
  )

  test("only a completed capture grants the actual captured amount"):
    val completed = order(capture).as[PayPalOrder]
    assertEquals(completed.capturedMoney.map(_.amount), Some(BigDecimal(5)))
    assertEquals(completed.capture.map(_.id.value), Some("CAPTURE-1"))
    assertEquals(completed.userId, Some(UserId("donor")))
    assertEquals(completed.giftTo, Some(UserId("recipient")))
    assertEquals(order(capture ++ Json.obj("status" -> "PENDING")).as[PayPalOrder].capturedMoney, None)

  test("subscription can be approved before its first payment"):
    val sub = Json
      .obj(
        "id" -> "I-TEST",
        "status" -> "ACTIVE",
        "custom_id" -> "donor",
        "subscriber" -> Json.obj("payer_id" -> "PAYER-1"),
        "billing_info" -> Json.obj("next_billing_time" -> "2026-10-22T12:00:00Z")
      )
      .as[PayPalSubscription]
    assertEquals(sub.userId, UserId("donor"))
    assertEquals(sub.capturedMoney, None)
    assert(sub.nextChargeAt.isDefined)

  test("monthly sale carries its own transaction ID, time and amount without optional custom data"):
    val sale = Json
      .obj(
        "id" -> "SALE-2",
        "state" -> "completed",
        "billing_agreement_id" -> "I-TEST",
        "amount" -> Json.obj("total" -> "7.50", "currency" -> "USD"),
        "create_time" -> "2026-09-22T12:00:00Z"
      )
      .as[PayPalSale]
      .toCapture
    assertEquals(sale.id.value, "SALE-2")
    assertEquals(sale.capturedMoney.map(_.amount), Some(BigDecimal("7.50")))
    assertEquals(sale.subscriptionId.map(_.value), Some("I-TEST"))

  test("subscription transaction response uses the gross donation, not net settlement"):
    val transaction = Json
      .obj(
        "id" -> "SALE-2",
        "status" -> "COMPLETED",
        "time" -> "2026-09-22T12:00:00Z",
        "amount_with_breakdown" -> Json.obj(
          "gross_amount" -> Json.obj("value" -> "7.50", "currency_code" -> "USD"),
          "net_amount" -> Json.obj("value" -> "6.90", "currency_code" -> "USD")
        )
      )
      .as[PayPalSubscriptionTransaction]
    assertEquals(
      transaction.toCapture(PayPalSubscriptionId("I-TEST")).capturedMoney.map(_.amount),
      Some(BigDecimal("7.50"))
    )

  test("cancelling renewal preserves paid expiry and payer identity"):
    val expiry = nowInstant.plusDays(20)
    val patron = Patron(
      UserId("donor"),
      payPalCheckout =
        Some(Patron.PayPalCheckout(None, PayPalPayerId("payer"), Some(PayPalSubscriptionId("I-TEST")))),
      expiresAt = Some(expiry)
    )
    val cancelled = patron.withoutPayPalRenewal
    assertEquals(cancelled.expiresAt, Some(expiry))
    assertEquals(cancelled.payPalCheckout.flatMap(_.subscriptionId), None)
    assertEquals(cancelled.payPalCheckout.map(_.payerId.value), Some("payer"))

  private def pricingFor(currency: java.util.Currency) =
    val money = Money(BigDecimal(1), currency)
    PlanPricing(
      List(money),
      money,
      Money(10000, currency),
      Money(250, currency),
      Money(2, currency),
      0.04,
      Money(1, currency)
    )

  for currency <- CurrencyApi.payPalCurrencies.toList.sortBy(_.getCurrencyCode) do
    test(s"${currency.getCurrencyCode}: form amounts match PayPal precision without rounding"):
      val pricing = pricingFor(currency)
      val wholeOnly = Set("JPY", "HUF", "TWD").contains(currency.getCurrencyCode)
      val expectedDigits = if wholeOnly then 0 else 2
      val whole = if wholeOnly then "10" else "10.00"
      val examples = List("10" -> whole, "10.000" -> whole) ++
        (if wholeOnly then Nil else List("10.35" -> "10.35", "10.350" -> "10.35"))
      for (input, expected) <- examples do
        val parsed = PlanCheckout.amountField(pricing).bind(Map("" -> input)).toOption.get
        assertEquals(parsed.scale, 3)
        val json = Json.toJson(Money(parsed, currency))(using PayPalClient.moneyWrites)
        assertEquals((json \ "value").as[String], expected)
        assertEquals((json \ "currency_code").as[String], currency.getCurrencyCode)
      // The browser uses the same precision for custom amounts and fee totals.
      val pricingJson = Json.toJson(pricing)(using PlanPricingApi.pricingWrites)
      assertEquals((pricingJson \ "fractionDigits").as[Int], expectedDigits)
      val invalid = if wholeOnly then "10.35" else "10.001"
      assert(PlanCheckout.amountField(pricing).bind(Map("" -> invalid)).isLeft)
      intercept[ArithmeticException]:
        Json.toJson(Money(BigDecimal(invalid), currency))(using PayPalClient.moneyWrites)
