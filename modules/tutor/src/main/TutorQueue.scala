package lila.tutor

import com.softwaremill.tagging.*
import reactivemongo.api.*
import reactivemongo.api.bson.*

import lila.db.dsl.{ *, given }
import lila.memo.{ CacheApi, SettingStore }

// #TODO use lila.memo.ParallelMongoQueue instead!
final private class TutorQueue(
    colls: TutorColls,
    gameRepo: lila.game.GameRepo,
    cacheApi: CacheApi,
    parallelism: SettingStore[Int] @@ Parallelism
)(using Executor, Scheduler):

  import TutorQueue.*
  import TutorBsonHandlers.given

  private val workQueue = scalalib.actor.AsyncActorSequencer(
    maxSize = Max(64),
    timeout = 5.seconds,
    "tutorQueue",
    lila.mon.asyncActorMonitor.full
  )

  private val durationCache = cacheApi.unit[FiniteDuration]("tutorQueue.duration"):
    _.refreshAfterWrite(1.minutes).buildAsyncFuture: _ =>
      colls.report:
        _.aggregateOne(): framework =>
          import framework.*
          Match($doc(TutorFullReport.F.version -> TutorFullReport.schemaVersion)) -> List(
            Sort(Descending(TutorFullReport.F.at)),
            Limit(100),
            Group(BSONNull)(TutorFullReport.F.millis -> AvgField(TutorFullReport.F.millis))
          )
        .map:
          ~_.flatMap(_.getAsOpt[Double](TutorFullReport.F.millis))
        .map(_.toInt.millis)

  def enqueue(config: TutorConfig): Fu[Status] = workQueue:
    for
      _ <- colls.queue:
        _.insert
          .one($doc(F.id -> config.user, F.config -> config, F.requestedAt -> nowInstant))
          .recover(lila.db.ignoreDuplicateKey)
      status <- fetchStatus(config.user)
    yield status

  def next: Fu[List[Item]] =
    colls.queue(_.find($empty).sort($sort.asc(F.requestedAt)).cursor[Item]().list(parallelism.get()))
  def start(userId: UserId): Funit = colls.queue(_.updateField($id(userId), F.startedAt, nowInstant).void)
  def remove(userId: UserId): Funit = colls.queue(_.delete.one($id(userId)).void)

  private def waitingGames(user: UserId): Fu[List[Pov]] = for
    all <- gameRepo.recentPovsByUserFromSecondary(
      user,
      60,
      lila.game.Query.turnsGt(10) ++ lila.game.Query.rated
    )
    povs = scalalib.ThreadLocalRandom.shuffle(all).take(30)
  yield povs

  def awaiting(user: UserId): Fu[Option[Awaiting]] =
    fetchStatus(user).flatMap:
      case q: InQueue => waitingGames(user).map(Awaiting(q, _).some)
      case _ => fuccess(none)

  def fetchStatus(user: UserId): Fu[Status] =
    colls.queue:
      _.byId[Item](user).flatMap:
        _.fold(fuccess(NotInQueue)): item =>
          for
            position <- colls.queue(_.countSel($doc(F.requestedAt.$lte(item.requestedAt))))
            avgDuration <- durationCache.get({})
            eta = ((position * avgDuration) / parallelism.get())
          yield InQueue(item, position, eta)

object TutorQueue:

  case class Item(config: TutorConfig, requestedAt: Instant, startedAt: Option[Instant] = none)

  sealed trait Status
  case object NotInQueue extends Status
  case class InQueue(item: Item, position: Int, eta: FiniteDuration) extends Status

  case class Awaiting(q: InQueue, games: List[Pov]):
    export q.item.config

  import TutorBsonHandlers.given
  private given BSONDocumentReader[Item] = Macros.reader

  object F:
    val id = "_id"
    val requestedAt = "requestedAt"
    val startedAt = "startedAt"
    val config = "config"
