package lila.plan

import play.api.libs.json.*

final class PlanWebhook(api: PlanApi)(using Executor):

  import JsonHandlers.stripe.given
  import JsonHandlers.payPal.given

  private lazy val stripeLogger = lila.log("plan.stripe.webhook")
  private lazy val payPalLogger = lila.log("plan.payPal.webhook")

  // Never trust an incoming webhook call.
  // Only read the Event ID from it,
  // then fetch the event from the stripe API.
  def stripe(js: JsValue): Funit =
    js.str("id")
      .so(api.stripe.getEvent)
      .flatMap:
        case None =>
          stripeLogger.warn(s"Forged $js")
          funit
        case Some(event) =>
          ~(for
            id <- event.str("id")
            name <- event.str("type")
            data <- (event \ "data" \ "object").asOpt[JsObject]
          yield
            lila.mon.plan.webhook("stripe", name).increment()
            stripeLogger.debug(s"$name $id ${Json.stringify(data).take(100)}")
            name match
              case "customer.subscription.deleted" =>
                val sub = data.asOpt[StripeSubscription].err(s"Invalid subscription $data")
                api.stripe.onSubscriptionDeleted(sub)
              case "charge.succeeded" =>
                val charge = data.asOpt[StripeCharge].err(s"Invalid charge $data")
                api.stripe.onCharge(charge)
              case _ => funit
          )

  def payPal(js: JsValue): Funit =
    js.get[PayPalEventId]("id")
      .so(api.payPal.getEvent)
      .flatMap:
        case None =>
          payPalLogger.warn(s"Forged event ${js.str("id")} ${Json.stringify(js).take(2000)}")
          funit
        case Some(event) =>
          lila.mon.plan.webhook("payPal", event.tpe).increment()
          payPalLogger.info:
            s"${event.tpe}: ${event.id} / ${event.resourceTpe}: ${event.resourceId}"
          event.tpe match
            case "CHECKOUT.ORDER.APPROVED" =>
              event.resourceId
                .map(PayPalOrderId.apply)
                .fold[Funit](fufail("PayPal order event is missing its ID"))(api.payPal.onOrderApproved)
            case "BILLING.SUBSCRIPTION.ACTIVATED" =>
              event.resourceId
                .map(PayPalSubscriptionId.apply)
                .fold[Funit](fufail("PayPal subscription event is missing its ID"))(
                  api.payPal.onSubscriptionActivated
                )
            case "PAYMENT.CAPTURE.COMPLETED" =>
              (event.resource \ "supplementary_data" \ "related_ids" \ "order_id")
                .asOpt[String]
                .map(PayPalOrderId.apply)
                .fold[Funit](fufail("PayPal capture is missing its order ID"))(api.payPal.onOrderEvent)
            case "PAYMENT.SALE.COMPLETED" =>
              event.resource
                .validate[PayPalSale]
                .fold(
                  _ => fufail("Invalid PayPal sale event"),
                  sale => api.payPal.onCaptureCompleted(sale.toCapture)
                )
            case "BILLING.SUBSCRIPTION.CANCELLED" | "BILLING.SUBSCRIPTION.EXPIRED" =>
              event.resourceId
                .map(PayPalSubscriptionId.apply)
                .fold[Funit](fufail("PayPal subscription event is missing its ID"))(
                  api.payPal.onSubscriptionCancelled
                )
            case _ => funit
