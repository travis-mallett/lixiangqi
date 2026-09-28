package lila.traffic

import reactivemongo.api.{ DB, WriteConcern }
import reactivemongo.api.bson.*
import play.api.libs.json.*
import lila.core.config.CollName
import lila.db.dsl.{ *, given }

final class TrafficStore(database: lila.db.AsyncDb, identityCheck: Option[String] = None)(using Executor):
  private val reportPermits = new java.util.concurrent.Semaphore(2)
  def limitedReport[A](work: => Fu[A]): Fu[A] =
    if !reportPermits.tryAcquire() then fufail("Another report is running")
    else fuccess(()).flatMap(_ => work).andThen { case _ => reportPermits.release() }
  val events = database(CollName("traffic_event"))
  val rollups = database(CollName("traffic_rollup"))
  val facts = database(CollName("traffic_subject_day"))
  val attempts = database(CollName("traffic_attempt"))
  val games = database(CollName("traffic_game"))
  val state = database(CollName("traffic_state"))
  val snapshots = database(CollName("traffic_snapshot"))
  val catalog = database(CollName("traffic_catalog"))
  val browsers = database(CollName("traffic_browser"))
  val subjects = database(CollName("traffic_subject"))
  val erasures = database(CollName("traffic_erasure"))
  val rebuilds = database(CollName("traffic_rebuild"))

  @volatile private var schemaChecked = false
  def ready: Funit =
    if schemaChecked then funit else checkSchema().map { _ => schemaChecked = true }

  private def checkSchema(): Funit = state(_.one[Bdoc]($id("schema"))).flatMap:
    case Some(doc) if doc.getAsOpt[Int]("version").contains(1) =>
      identityCheck.so: check =>
        for
          _ <- state(
            _.update.one($id("identity"), $doc("$setOnInsert" -> $doc("check" -> check)), upsert = true)
          )
          saved <- state(_.one[Bdoc]($id("identity")))
          _ <-
            if saved.flatMap(_.getAsOpt[String]("check")).contains(check) then funit
            else
              fufail[Unit](
                "Traffic identity key changed. Restore the original key before processing analytics."
              )
        yield ()
    case _ =>
      fufail("Traffic schema is missing. Run 20260924_traffic_stats_v1.js before enabling collection.")

  /** Upsert with setOnInsert is retry-safe, including partial batches and unknown network outcomes. */
  def append(batch: List[StoredEvent]): Funit = ready.flatMap: _ =>
    events: coll =>
      val update = coll.update(ordered = false)
      for
        erased <- erasures(_.find($inIds(batch.map(_.subject).distinct)).cursor[Bdoc]().list(batch.size))
        excluded = erased.flatMap(_.getAsOpt[String]("_id")).toSet
        elements <- batch
          .filterNot(e => excluded(e.subject))
          .traverse: event =>
            update.element(
              $id(event.id),
              $doc(
                "$setOnInsert" -> (bsonWriteDoc(event) ++
                  $doc("month" -> TrafficTime.bucket(event.at, "month")))
              ),
              upsert = true,
              multi = false
            )
        _ <- elements.nonEmpty.so(update.many(elements).void)
        // Close the race with a deletion that completed while this batch was in flight.
        admitted = batch.map(_.subject).distinct.filterNot(excluded)
        _ <- admitted.nonEmpty.so(
          erasures(
            _.update
              .one($inIds(admitted) ++ $doc("complete" -> true), $set("complete" -> false), multi = true)
              .void
          )
        )
      yield ()

  def rememberCatalog(): Funit = ready.flatMap: _ =>
    catalog: coll =>
      val update = coll.update(ordered = false)
      val choices = TrafficCatalog.choices.toList.flatMap((component, options) =>
        options.toList.map((key, label) => (component, key, label))
      )
      for
        elements <- choices.traverse: (component, key, label) =>
          update.element(
            $id(s"$component/$key"),
            $set(
              $doc("component" -> component, "key" -> key, "label" -> label, "lastSeen" -> nowInstant)
            ) ++ $doc("$setOnInsert" -> $doc("firstSeen" -> nowInstant)),
            upsert = true,
            multi = false
          )
        _ <- update.many(elements)
      yield ()

  def historicalCatalog: Fu[JsObject] = catalog(_.find($empty).cursor[Bdoc]().list(10000)).map: rows =>
    val historical = rows.flatMap: row =>
      for
        component <- row.getAsOpt[String]("component"); key <- row.getAsOpt[String]("key");
        label <- row.getAsOpt[String]("label")
      yield component -> (key -> label)
    val merged = historical.groupMap(_._1)(_._2).view.mapValues(_.toMap).toMap
    Json.obj("appearance" -> (merged ++ TrafficCatalog.choices.map: (component, options) =>
      component -> (merged.getOrElse(component, Map.empty) ++ options)))

  def transaction[A](work: DB => Fu[A]): Fu[A] = events: coll =>
    coll.db
      .startSession()
      .flatMap: session =>
        val result = session
          .startTransaction(
            Some(WriteConcern(WriteConcern.Majority, j = true, fsync = false, wtimeout = Some(10000)))
          )
          .flatMap: db =>
            work(db).flatMap(value => db.commitTransaction().inject(value))
        result.transformWith:
          case scala.util.Success(value) => session.endSession().inject(value)
          case scala.util.Failure(error) =>
            session
              .abortTransaction()
              .recover { case _ => session }
              .flatMap(_.endSession())
              .recover { case _ => session }
              .flatMap(_ => fufail(error))

  def status: Fu[JsObject] =
    for
      checkpoint <- state(_.one[Bdoc]($id("processor")))
      oldest <- events(_.find($doc("processed" -> false)).sort($sort.asc("receivedAt")).one[StoredEvent])
      schema <- state(_.one[Bdoc]($id("schema")))
    yield Json.obj(
      "processedAt" -> checkpoint.flatMap(_.getAsOpt[Instant]("at")).map(_.toString),
      "oldestPendingAt" -> oldest.map(_.receivedAt.toString),
      "measurementStartedAt" -> schema.flatMap(_.getAsOpt[Instant]("installedAt")).map(_.toString),
      "retention" -> "indefinite"
    )

  def reportsReady: Funit = for
    erasing <- erasures(_.exists($doc("complete" -> false)))
    rebuilding <- rebuilds(_.exists($empty))
    _ <-
      if erasing || rebuilding then fufail[Unit]("Analytics are rebuilding after account erasure") else funit
  yield ()
