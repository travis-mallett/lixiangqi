package lila.traffic

import lila.db.dsl.{ *, given }

/** Erasure and rebuilding share the processor's single worker. Every bounded step is restart-safe. */
final class TrafficErasure(store: TrafficStore, identity: TrafficIdentity, processor: TrafficProcessor)(using
    Executor
):
  def request(id: UserId): Funit =
    // Record the tombstone before the site's account-deletion cursor advances.
    store.ready.flatMap(_ =>
      store.erasures(
        _.update
          .one(
            $id(identity("account", id.value)),
            $set("complete" -> false) ++ $doc("$setOnInsert" -> $doc("requestedAt" -> nowInstant)),
            upsert = true
          )
          .void
      )
    )

  /** True means maintenance owns this iteration; ordinary processing must wait. */
  def step(): Fu[Boolean] =
    store.ready.flatMap: _ =>
      store
        .erasures(_.one[Bdoc]($doc("complete" -> false)))
        .flatMap:
          case Some(tombstone) => eraseChunk(tombstone.getAsOpt[String]("_id").get).inject(true)
          case None =>
            store
              .rebuilds(_.find($empty).sort($sort.asc("_id")).one[Bdoc])
              .flatMap:
                case Some(rebuild) => rebuildChunk(rebuild).inject(true)
                case None => fuccess(false)

  private def eraseChunk(subject: String): Funit = store.transaction: db =>
    val events: Coll = db.collection(store.events.name.value)
    val rebuilds: Coll = db.collection(store.rebuilds.name.value)
    val erasures: Coll = db.collection(store.erasures.name.value)
    for
      batch <- events.find($doc("subject" -> subject)).cursor[StoredEvent]().list(100)
      _ <- batch
        .map(e => TrafficTime.bucket(e.at, "month"))
        .distinct
        .traverse: month =>
          rebuilds.update.one(
            $id(month.toString),
            $set($doc("month" -> month, "phase" -> "clear", "cutoff" -> nowInstant)) ++ $unset("cursor"),
            upsert = true
          )
      _ <- batch.nonEmpty.so(events.delete.one($inIds(batch.map(_.id)), limit = Some(0)).void)
      finished <-
        if batch.nonEmpty then fuccess(false)
        else
          // Remove remaining linkable facts in small chunks as well.
          List(store.facts, store.attempts, store.browsers)
            .traverse: collection =>
              val coll: Coll = db.collection(collection.name.value)
              coll
                .find($doc("subject" -> subject), $id(true).some)
                .cursor[Bdoc]()
                .list(100)
                .flatMap: rows =>
                  val ids = rows.flatMap(_.getAsOpt[String]("_id"))
                  ids.nonEmpty.so(coll.delete.one($inIds(ids), limit = Some(0)).void).inject(ids.isEmpty)
            .map(_.forall(value => value))
      _ <- finished.so:
        val subjects: Coll = db.collection(store.subjects.name.value)
        subjects.delete
          .one($id(subject))
          .flatMap: _ =>
            erasures.update.one($id(subject), $set("complete" -> true)).void
    yield ()

  private def rebuildChunk(job: Bdoc): Funit = store.transaction: db =>
    val month = job.getAsOpt[Instant]("month").get
    val until = month.atZone(java.time.ZoneOffset.UTC).plusMonths(1).toInstant
    val rebuilds: Coll = db.collection(store.rebuilds.name.value)
    val id = $id(month.toString)
    val range = $doc("$gte" -> month, "$lt" -> until)
    if job.getAsOpt[String]("phase").contains("clear") then
      for
        empty <- List(store.rollups -> "at", store.facts -> "day").traverse: (collection, field) =>
          val coll: Coll = db.collection(collection.name.value)
          coll
            .find($doc(field -> range), $id(true).some)
            .cursor[Bdoc]()
            .list(500)
            .flatMap: rows =>
              val ids = rows.flatMap(_.getAsOpt[String]("_id"))
              ids.nonEmpty.so(coll.delete.one($inIds(ids), limit = Some(0)).void).inject(ids.isEmpty)
        _ <- empty.forall(value => value).so(rebuilds.update.one(id, $set("phase" -> "replay")).void)
      yield ()
    else
      val events: Coll = db.collection(store.events.name.value)
      val after = job.getAsOpt[String]("cursor").fold($empty)(cursor => $doc("_id" -> $doc("$gt" -> cursor)))
      for
        batch <- events
          .find(
            $doc(
              "month" -> month,
              "receivedAt" -> $doc("$lte" -> job.getAsOpt[Instant]("cutoff").get)
            ) ++ after
          )
          .sort($sort.asc("_id"))
          .cursor[StoredEvent]()
          .list(100)
        _ <- processor.processBatch(db, batch)
        _ <- batch.lastOption match
          case Some(last) => rebuilds.update.one(id, $set("cursor" -> last.id)).void
          case None => rebuilds.delete.one(id).void
      yield ()
