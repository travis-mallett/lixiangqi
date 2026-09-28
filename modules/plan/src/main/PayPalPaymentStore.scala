package lila.plan

import reactivemongo.api.{ DB, WriteConcern }
import lila.core.user.Plan
import lila.db.dsl.{ *, given }

// Kept separate from provider HTTP calls so the full commit/replay contract is testable.
private[plan] final class PayPalPaymentStore(
    mongo: PlanMongo,
    updatePlan: (UserId, DB) => (Plan => Plan) => Fu[(User, User)]
)(using Executor):
  import BsonHandlers.PatronHandlers.given
  import BsonHandlers.ChargeHandlers.given

  // The unique PayPal transaction ID, receipt, expiry and user plan commit atomically.
  // Concurrent deliveries conflict; retrying observes the committed receipt and does nothing.
  def commit(
      charge: Charge,
      lifetime: Boolean,
      attempts: Int = 3
  ): Fu[Option[(User, User)]] =
    mongo.charge.db
      .startSession()
      .flatMap: session =>
        val result = session
          .startTransaction(
            Some(WriteConcern(WriteConcern.Majority, j = true, fsync = false, wtimeout = Some(10000)))
          )
          .flatMap: db =>
            val charges: Coll = db.collection(mongo.charge.name)
            val patrons: Coll = db.collection(mongo.patron.name)
            val recipient = charge.giftTo.orElse(charge.userId).get
            val payment = charges
              .one[Charge]($id(charge.id))
              .map(_.isDefined)
              .flatMap:
                case true => fuccess(none[(User, User)])
                case false =>
                  for
                    _ <- charges.insert.one(charge)
                    previous <- patrons.one[Patron]($id(recipient))
                    patron = previous.getOrElse(Patron(recipient))
                    levelUp = patron.lastLevelUp.exists(_.isBefore(charge.date.minusDays(25)))
                    expiry = (patron.expiresAt.toList :+ charge.date.plusMonths(1).plusDays(1)).max
                    updated = patron.copy(
                      payPalCheckout = if charge.giftTo.isDefined then patron.payPalCheckout
                      else if charge.payPalCheckout.exists(_.renew) then charge.payPalCheckout
                      else patron.payPalCheckout.orElse(charge.payPalCheckout),
                      free = if charge.giftTo.isDefined then Patron.Free(charge.date, charge.userId).some
                      else patron.free,
                      expiresAt = expiry.some,
                      lastLevelUp = if levelUp || patron.lastLevelUp.isEmpty then charge.date.some
                      else patron.lastLevelUp
                    )
                    _ <- patrons.update.one($id(recipient), updated, upsert = true)
                    users <- updatePlan(recipient, db): plan =>
                      val next = if levelUp then plan.incMonths else plan.enable
                      next.copy(
                        active = plan.lifetime || lifetime || expiry.isAfter(nowInstant),
                        lifetime = plan.lifetime || lifetime
                      )
                  yield users.some
            payment.flatMap(value => db.commitTransaction().inject(value))
        result.transformWith:
          case scala.util.Success(value) => session.endSession().inject(value)
          case scala.util.Failure(error) =>
            session
              .abortTransaction()
              .recover { case _ => session }
              .flatMap(_.endSession())
              .recover { case _ => session }
              .flatMap(_ => if attempts > 1 then commit(charge, lifetime, attempts - 1) else fufail(error))
