package lila.plan

import reactivemongo.api.WriteConcern
import lila.db.dsl.{ *, given }

final private class PlanExpiration(
    userApi: lila.core.user.UserApi,
    lightUserApi: lila.core.user.LightUserApi,
    patronColl: Coll,
    notifier: PlanNotifier
)(using scheduler: Scheduler)(using Executor):

  import BsonHandlers.PatronHandlers.given

  scheduler.scheduleWithFixedDelay(5.minutes, 5.minutes): () =>
    run().failed.foreach(error => logger.error("Patron expiration failed", error))

  private def run(): Funit =
    patronColl
      .list[Patron]($doc("expiresAt".$lte(nowInstant)), 50)
      .flatMap:
        _.sequentiallyVoid(expire)

  // Check the paid expiry again inside the same transaction as the plan update.
  // A concurrent renewal either wins first or retries after expiration; it cannot be lost.
  private def expire(candidate: Patron): Funit =
    patronColl.db
      .startSession()
      .flatMap: session =>
        val result = session
          .startTransaction(
            Some(
              WriteConcern(WriteConcern.Majority, j = true, fsync = false, wtimeout = Some(10000))
            )
          )
          .flatMap: db =>
            val patrons: Coll = db.collection(patronColl.name)
            patrons
              .one[Patron]($id(candidate.id))
              .flatMap:
                case Some(patron) if patron.expiresAt.exists(!_.isAfter(nowInstant)) =>
                  for
                    _ <- patrons.update.one($id(patron.id), patron.removePayPal)
                    users <- userApi.updatePlanInTransaction(patron.id, db): plan =>
                      if plan.lifetime then plan else plan.disable
                    _ <- db.commitTransaction()
                  yield Some(users)
                case _ => db.commitTransaction().inject(None)
        result.transformWith:
          case scala.util.Success(users) =>
            session
              .endSession()
              .map: _ =>
                users.foreach: (before, after) =>
                  lightUserApi.invalidate(after.id)
                  if before.plan.active && !after.plan.active then notifier.onExpire(after)
          case scala.util.Failure(error) =>
            session
              .abortTransaction()
              .recover { case _ => session }
              .flatMap(_.endSession())
              .recover { case _ => session }
              .flatMap(_ => fufail(error))
