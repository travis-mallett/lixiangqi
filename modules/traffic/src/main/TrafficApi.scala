package lila.traffic

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Semaphore
import java.time.Instant
import java.util.concurrent.atomic.{ AtomicBoolean, AtomicLong }
import play.api.libs.json.*
import play.api.mvc.RequestHeader

import lila.common.{ Bus, HTTPRequest }
import lila.core.traffic.TrafficEvent

final class TrafficApi(
    val enabled: Boolean,
    identity: TrafficIdentity,
    store: TrafficStore,
    geoIP: TrafficGeoIP
)(using Executor):
  private val queue = new ArrayBlockingQueue[StoredEvent](4096)
  private val flushing = new AtomicBoolean(false)
  private val writers = new Semaphore(8)
  val dropped = new AtomicLong(0)
  val rejected = new AtomicLong(0)
  private val seen = lila.memo.CacheApi.scaffeineNoScheduler
    .maximumSize(10000)
    .expireAfterWrite(30.minutes)
    .build[String, Map[String, String]]()

  Bus.sub[TrafficEvent] { case event => domain(event) }

  def ingest(batch: ClientBatch, user: Option[User], request: RequestHeader): Funit =
    val now = nowInstant
    val browser = identity("browser", batch.browser)
    val subject = user.fold(browser)(u => identity("account", u.id.value))
    val location = geoIP(HTTPRequest.ipAddress(request))
    val country = location.flatMap(_.countryCode).getOrElse("unknown")
    val geo = Map(
      "country" -> country,
      "region" -> location.flatMap(_.region).fold("unknown")(r => s"$country/$r"),
      "city" -> location
        .flatMap(_.city)
        .fold("unknown")(c => s"$country/${location.flatMap(_.region).getOrElse("unknown")}/$c")
    )
    val events = batch.events.map: e =>
      val dimensions = e.dimensions ++ geo
      seen.put(
        subject,
        dimensions.filter((k, _) =>
          Set("country", "region", "city", "device", "language", "referrer", "campaign", "source", "medium")(
            k
          )
        )
      )
      e.attempt.foreach(attempt =>
        seen.put(
          s"attempt/$attempt",
          dimensions.filter((k, _) =>
            Set(
              "country",
              "region",
              "city",
              "device",
              "language",
              "referrer",
              "campaign",
              "source",
              "medium"
            )(k)
          )
        )
      )
      StoredEvent(
        identity("event", s"$browser/${e.id}"),
        e.kind,
        Instant.ofEpochMilli(e.at),
        now,
        subject,
        user.isDefined,
        browser,
        identity("session", e.session),
        e.visit,
        e.attempt,
        dimensions,
        e.values
      )
    if !writers.tryAcquire() then fufail("Traffic ingestion is busy")
    else store.append(events).andThen { case _ => writers.release() }

  def domain(event: TrafficEvent): Unit =
    if enabled then if !queue.offer(domainRecord(event)) then dropped.incrementAndGet()

  private def domainRecord(event: TrafficEvent, contextual: Boolean = true): StoredEvent =
    val subject = event.userId.fold(identity("anonymous-domain", event.correlation.getOrElse(event.id)))(u =>
      identity("account", u.value)
    )
    val dimensions = Map(
      "country" -> "unknown",
      "region" -> "unknown",
      "city" -> "unknown",
      "language" -> "unknown",
      "device" -> "unknown",
      "referrer" -> "unknown",
      "source" -> "unknown",
      "medium" -> "unknown",
      "campaign" -> "unknown"
    ) ++ (if contextual then contextFor(subject, event.correlation) else Map.empty) ++ event.dimensions
    StoredEvent(
      identity("domain-event", event.id),
      event.kind,
      event.at,
      nowInstant,
      subject,
      event.userId.isDefined,
      "",
      "",
      "",
      event.correlation,
      dimensions,
      event.values
    )

  /** Backfills await durable storage before advancing their cursor; they never use the lossy live queue. */
  def persistDomain(events: List[TrafficEvent]): Funit =
    store.append(events.map(domainRecord(_, contextual = false)))

  private def contextFor(subject: String, attempt: Option[String]): Map[String, String] =
    seen.getIfPresent(subject).getOrElse(Map.empty) ++
      attempt.flatMap(id => seen.getIfPresent(s"attempt/$id")).getOrElse(Map.empty)

  def flush(): Funit =
    if !flushing.compareAndSet(false, true) then funit
    else
      val drained = new java.util.ArrayList[StoredEvent]()
      queue.drainTo(drained, 200)
      import scala.jdk.CollectionConverters.*
      val batch = drained.asScala.toList
      val enriched = batch.map(e =>
        e.copy(dimensions =
          e.dimensions ++
            contextFor(e.subject, e.attempt).filter((key, _) => e.dimensions.get(key).forall(_ == "unknown"))
        )
      )
      store
        .append(enriched)
        .recoverWith: error =>
          batch.foreach(e => if !queue.offer(e) then dropped.incrementAndGet())
          fufail(error)
        .andThen { case _ => flushing.set(false) }

  def health: Fu[JsObject] = store.status.map: status =>
    status ++ Json.obj(
      "enabled" -> enabled,
      "buffered" -> queue.size,
      "dropped" -> dropped.get,
      "rejected" -> rejected.get,
      "geoAvailable" -> geoIP.isAvailable,
      "catalog" -> TrafficCatalog.json
    )
