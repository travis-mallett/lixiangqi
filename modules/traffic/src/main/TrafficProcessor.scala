package lila.traffic

import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import reactivemongo.api.DB
import lila.db.dsl.{ *, given }

final class TrafficProcessor(store: TrafficStore)(using Executor):
  private val running = new AtomicBoolean(false)

  def run(): Funit =
    if !running.compareAndSet(false, true) then funit
    else store.ready.flatMap(_ => store.transaction(process)).andThen { case _ => running.set(false) }

  private[traffic] def process(db: DB): Funit =
    val events: Coll = db.collection(store.events.name.value)
    events
      .find($doc("processed" -> false))
      .sort($sort.asc("receivedAt"))
      .cursor[StoredEvent]()
      .list(100)
      .flatMap(processBatch(db, _))

  private[traffic] def processBatch(db: DB, batch: List[StoredEvent]): Funit =
    val events: Coll = db.collection(store.events.name.value)
    val rollups: Coll = db.collection(store.rollups.name.value)
    val subjects: Coll = db.collection(store.facts.name.value)
    val attempts: Coll = db.collection(store.attempts.name.value)
    val games: Coll = db.collection(store.games.name.value)
    val state: Coll = db.collection(store.state.name.value)
    val browsers: Coll = db.collection(store.browsers.name.value)
    val accounts: Coll = db.collection(store.subjects.name.value)
    for
      grouped <- fuccess(contributions(batch))
      previous <- grouped.nonEmpty.so:
        rollups.find($inIds(grouped.keys)).cursor[TrafficRollup]().list(grouped.size)
      old = previous.map(r => r.id -> r).toMap
      update = rollups.update(ordered = false)
      elements <- grouped.toList.traverse: (id, contribution) =>
        val (grain, at, dimension, key, registered, global, events) = contribution
        val prev = old.get(id)
        val counts = events.foldLeft(prev.fold(Map.empty[String, Long])(_.counts)): (acc, e) =>
          TrafficMetrics
            .counts(e)
            .foldLeft(acc): (counts, metric) =>
              counts.updated(metric._1, counts.getOrElse(metric._1, 0L) + metric._2)
        val measured = events.filter(e => e.kind == "page" || e.kind == "attention")
        val row = TrafficRollup(
          id,
          grain,
          at,
          dimension,
          key,
          registered,
          counts,
          TrafficDistinct.merge(prev.map(_.visitors), measured.map(_.browser)),
          TrafficDistinct.merge(prev.map(_.sessions), measured.map(_.session)),
          TrafficDistinct.merge(
            prev.map(_.participants),
            events.filter(e => e.registered || e.browser.nonEmpty).map(_.subject)
          ),
          global
        )
        update.element($id(id), row, upsert = true, multi = false)
      _ <- elements.nonEmpty.so(update.many(elements).void)
      _ <- writeSubjectDays(subjects, batch)
      _ <- writeAttempts(attempts, batch)
      _ <- writeGames(games, batch)
      _ <- writeBrowsers(browsers, batch)
      _ <- writeAccounts(accounts, batch)
      _ <- batch.nonEmpty.so(
        events.update.one($inIds(batch.map(_.id)), $set("processed" -> true), multi = true).void
      )
      _ <- state.update.one($id("processor"), $set("at" -> nowInstant), upsert = true)
    yield ()

  private def writeAccounts(coll: Coll, batch: List[StoredEvent]): Funit =
    val grouped = batch.filter(_.registered).groupBy(_.subject).toList
    val update = coll.update(ordered = false)
    for
      elements <- grouped.traverse: (subject, events) =>
        val created = events.filter(_.kind == "user.registered").map(_.at).minOption
        val meaningful = events
          .filter(e =>
            Set("puzzle.completed", "user.gameCompleted", "notation.finished", "lesson.completed")(e.kind)
          )
          .map(_.at)
          .minOption
        val minimum = $doc("firstObservedAt" -> events.map(_.at).min) ++
          created.fold($empty)(at => $doc("registeredAt" -> at)) ++ meaningful.fold($empty)(at =>
            $doc("firstActivityAt" -> at)
          )
        update.element(
          $id(subject),
          $doc("$min" -> minimum, "$max" -> $doc("lastObservedAt" -> events.map(_.at).max)),
          upsert = true,
          multi = false
        )
      _ <- elements.nonEmpty.so(update.many(elements).void)
    yield ()

  private def writeBrowsers(coll: Coll, batch: List[StoredEvent]): Funit =
    val latest = batch
      .filter(e => e.kind == "attention" || e.kind == "page" || e.kind == "audio.changed")
      .groupBy(e => s"${e.subject}/${e.browser}")
      .toList
      .map((id, events) => id -> events.maxBy(_.at))
    for
      previous <- latest.nonEmpty.so(coll.find($inIds(latest.map(_._1))).cursor[Bdoc]().list(latest.size))
      dates = previous
        .flatMap(row =>
          for id <- row.getAsOpt[String]("_id"); at <- row.getAsOpt[Instant]("at") yield id -> at
        )
        .toMap
      update = coll.update(ordered = false)
      elements <- latest
        .filter((id, e) => dates.get(id).forall(_.isBefore(e.at)))
        .traverse: (id, event) =>
          update.element(
            $id(id),
            $set(
              $doc(
                "at" -> event.at,
                "subject" -> event.subject,
                "registered" -> event.registered,
                "dimensions" -> event.dimensions
              )
            ),
            upsert = true,
            multi = false
          )
      _ <- elements.nonEmpty.so(update.many(elements).void)
    yield ()

  private type Contribution = (String, Instant, String, String, Boolean, Boolean, List[StoredEvent])
  private def contributions(batch: List[StoredEvent]): Map[String, Contribution] =
    val rows = for
      event <- batch
      grain <- List("hour", "day", "month")
      at = TrafficTime.bucket(event.at, grain)
      (dimension, key) <- TrafficMetrics.dimensions(event).toList
    yield (grain, at, dimension, key, event.registered, event.kind.startsWith("game.")) -> event
    rows
      .groupMap(_._1)(_._2)
      .map: (tuple, events) =>
        val (grain, at, dimension, key, registered, global) = tuple
        digest(s"$grain/$at/$dimension/$key/$registered/$global") -> (
          grain,
          at,
          dimension,
          key,
          registered,
          global,
          events
        )

  private def writeSubjectDays(coll: Coll, batch: List[StoredEvent]): Funit =
    val grouped = batch.groupBy(e => (e.subject, TrafficTime.bucket(e.at, "day")))
    val update = coll.update(ordered = false)
    for
      elements <- grouped.toList.traverse: (subjectDay, events) =>
        val (subject, day) = subjectDay
        val counts = events.flatMap(TrafficMetrics.counts).groupMapReduce(_._1)(_._2)(_ + _)
        val set = $doc("subject" -> subject, "day" -> day, "registered" -> events.head.registered)
        val inc = $doc(counts.map((key, count) => s"counts.$key" -> reactivemongo.api.bson.BSONLong(count)))
        update.element($id(s"$subject/$day"), $set(set) ++ $doc("$inc" -> inc), upsert = true, multi = false)
      _ <- elements.nonEmpty.so(update.many(elements).void)
    yield ()

  private def writeAttempts(coll: Coll, batch: List[StoredEvent]): Funit =
    val grouped = batch.filter(_.attempt.isDefined).groupBy(_.attempt.get)
    val update = coll.update(ordered = false)
    for
      elements <- grouped.toList.traverse: (id, events) =>
        val latest = events.maxBy(_.at)
        val stages = events
          .groupBy(_.kind.replace('.', '_'))
          .map: (kind, matching) =>
            s"stages.$kind" -> matching.map(_.at).min
        val game = events.flatMap(_.dimensions.get("game")).headOption
        val dimensions = events.sortBy(_.at).flatMap(_.dimensions).toMap
        update.element(
          $id(id),
          $set(
            $doc(
              "subject" -> latest.subject,
              "attempt" -> latest.attempt,
              "registered" -> latest.registered,
              "dimensions" -> dimensions
            ) ++ game.fold($empty)(id => $doc("game" -> id))
          ) ++
            $doc(
              "$min" -> $doc(
                stages.map((key, at) =>
                  key -> summon[reactivemongo.api.bson.BSONWriter[Instant]].writeTry(at).get
                )
              ),
              "$max" -> $doc("lastAt" -> latest.at)
            ),
          upsert = true,
          multi = false
        )
      _ <- elements.nonEmpty.so(update.many(elements).void)
    yield ()

  private def writeGames(coll: Coll, batch: List[StoredEvent]): Funit =
    val grouped = batch
      .filter(e => e.kind == "game.firstMove" || e.kind == "game.completed")
      .flatMap(e => e.dimensions.get("game").map(_ -> e))
      .groupMap(_._1)(_._2)
    val update = coll.update(ordered = false)
    for
      elements <- grouped.toList.traverse: (id, events) =>
        val stages = events
          .groupBy(_.kind.replace('.', '_'))
          .map((kind, es) =>
            kind -> summon[reactivemongo.api.bson.BSONWriter[Instant]].writeTry(es.map(_.at).min).get
          )
        val outcome = events.find(_.kind == "game.completed").flatMap(_.dimensions.get("outcome"))
        update.element(
          $id(id),
          $doc("$min" -> $doc(stages)) ++ outcome.fold($empty)(value => $set("outcome" -> value)),
          upsert = true,
          multi = false
        )
      _ <- elements.nonEmpty.so(update.many(elements).void)
    yield ()

  private def digest(value: String): String =
    java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(UTF_8)))
