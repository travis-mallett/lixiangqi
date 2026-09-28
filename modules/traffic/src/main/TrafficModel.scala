package lila.traffic

import java.time.{ Instant, ZoneOffset }
import java.time.temporal.ChronoUnit
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import play.api.libs.json.*
import reactivemongo.api.bson.*
import org.apache.datasketches.hll.{ HllSketch, Union, TgtHllType }
import org.apache.datasketches.memory.Memory
import lila.db.dsl.given

case class ClientEvent(
    id: String,
    kind: String,
    at: Long,
    visit: String,
    session: String,
    attempt: Option[String],
    dimensions: Map[String, String],
    values: Map[String, Long]
)
case class ClientBatch(browser: String, events: List[ClientEvent])
object ClientBatch:
  given Reads[ClientEvent] = Json.reads
  given Reads[ClientBatch] = Json.reads
  private val token = "[a-zA-Z0-9_-]{8,80}".r
  def validId(id: String) = token.matches(id)
  def validate(batch: ClientBatch, now: Instant): Boolean =
    validId(batch.browser) && batch.events.nonEmpty && batch.events.size <= 20 &&
      batch.events.forall: e =>
        validId(e.id) && validId(e.visit) && validId(e.session) && e.attempt.forall(validId) && TrafficCatalog
          .clientKinds(e.kind) &&
          e.at >= now.minus(1, ChronoUnit.DAYS).toEpochMilli && e.at <= now.plusSeconds(60).toEpochMilli &&
          TrafficCatalog.validDimensions(e.dimensions) && e.values.forall: (key, value) =>
            TrafficCatalog.valueLimits.get(key).exists(limit => value >= 0 && value <= limit)

case class StoredEvent(
    @Macros.Annotations.Key("_id") id: String,
    kind: String,
    at: Instant,
    receivedAt: Instant,
    subject: String,
    registered: Boolean,
    browser: String,
    session: String,
    visit: String,
    attempt: Option[String],
    dimensions: Map[String, String],
    values: Map[String, Long],
    processed: Boolean = false,
    schema: Int = 1
)
object StoredEvent:
  given BSONDocumentHandler[StoredEvent] = Macros.handler

case class TrafficRollup(
    @Macros.Annotations.Key("_id") id: String,
    grain: String,
    at: Instant,
    dimension: String,
    key: String,
    registered: Boolean,
    counts: Map[String, Long],
    visitors: String,
    sessions: String,
    participants: String,
    global: Boolean = false
)
object TrafficRollup:
  given BSONDocumentHandler[TrafficRollup] = Macros.handler

final class TrafficIdentity(secret: String):
  require(secret.length >= 32, "Traffic identity key must contain at least 32 characters")
  def apply(kind: String, value: String): String =
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret.getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"))
    Base64.getUrlEncoder.withoutPadding.encodeToString(
      mac.doFinal(s"$kind:$value".getBytes(java.nio.charset.StandardCharsets.UTF_8))
    )

object TrafficTime:
  val grains = Set("hour", "day", "week", "month", "year")
  def bucket(at: Instant, grain: String): Instant =
    val day = at.atZone(ZoneOffset.UTC).toLocalDate
    grain match
      case "hour" => at.truncatedTo(ChronoUnit.HOURS)
      case "day" => day.atStartOfDay(ZoneOffset.UTC).toInstant
      case "week" => day.minusDays(day.getDayOfWeek.getValue - 1L).atStartOfDay(ZoneOffset.UTC).toInstant
      case "month" => day.withDayOfMonth(1).atStartOfDay(ZoneOffset.UTC).toInstant
      case "year" => day.withDayOfYear(1).atStartOfDay(ZoneOffset.UTC).toInstant
      case _ => throw IllegalArgumentException("Invalid traffic interval")

/** Merge sketches, not their estimates. Small cardinalities use the library's sparse representation. */
object TrafficDistinct:
  def merge(previous: Option[String], subjects: Iterable[String]): String =
    val sketch = previous.fold(new HllSketch(12))(read)
    subjects.foreach(sketch.update)
    encode(sketch)
  def union(encoded: Iterable[String]): HllSketch =
    val union = new Union(12)
    encoded.foreach(value => union.update(read(value)))
    union.getResult(TgtHllType.HLL_4)
  private def read(value: String) = HllSketch.heapify(Memory.wrap(Base64.getDecoder.decode(value)))
  private def encode(sketch: HllSketch) = Base64.getEncoder.encodeToString(sketch.toCompactByteArray)
