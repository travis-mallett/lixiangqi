package lila.traffic

import java.time.{ Instant, LocalDate, ZoneOffset }
import java.time.temporal.ChronoUnit
import play.api.libs.json.*
import lila.db.dsl.{ *, given }

case class TrafficFilter(
    from: Instant,
    until: Instant,
    grain: String,
    dimension: String,
    key: Option[String],
    registered: Option[Boolean]
)
object TrafficFilter:
  def read(params: Map[String, String], now: Instant): Either[String, TrafficFilter] = scala.util
    .Try:
      val from = params.get("from").fold(now.minus(30, ChronoUnit.DAYS).truncatedTo(ChronoUnit.DAYS))(date)
      val until = params.get("until").fold(now.truncatedTo(ChronoUnit.DAYS).plus(1, ChronoUnit.DAYS))(date)
      val grain = params.getOrElse("grain", "day")
      val dimension = params.getOrElse("dimension", "all")
      require(from.isBefore(until) && !until.isAfter(now.plus(2, ChronoUnit.DAYS)), "Invalid date range")
      require(TrafficTime.grains(grain), "Invalid interval")
      require(TrafficMetrics.breakdowns(dimension), "Invalid dimension")
      val buckets = grain match
        case "hour" => ChronoUnit.HOURS.between(from, until)
        case "day" => ChronoUnit.DAYS.between(from, until)
        case "week" => ChronoUnit.DAYS.between(from, until) / 7
        case "month" => ChronoUnit.MONTHS.between(from.atZone(ZoneOffset.UTC), until.atZone(ZoneOffset.UTC))
        case _ => ChronoUnit.YEARS.between(from.atZone(ZoneOffset.UTC), until.atZone(ZoneOffset.UTC))
      require(buckets <= 500, "Select a coarser interval for this date range")
      val registered = params.get("audience").collect { case "registered" => true; case "anonymous" => false }
      TrafficFilter(
        from,
        until,
        grain,
        dimension,
        params.get("key").filter(_.nonEmpty).map(_.take(300)),
        registered
      )
    .toEither
    .left
    .map(e => Option(e.getMessage).getOrElse("Invalid report query"))

  private def date(value: String): Instant = LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant

final class TrafficQuery(store: TrafficStore)(using Executor):
  private val cache = lila.memo.CacheApi.scaffeineNoScheduler
    .maximumSize(128)
    .expireAfterWrite(30.seconds)
    .build[TrafficFilter, JsObject]()

  def invalidate(): Unit = cache.invalidateAll()

  def report(filter: TrafficFilter): Fu[JsObject] = store.reportsReady.flatMap: _ =>
    cache.getIfPresent(filter) match
      case Some(value) => fuccess(value)
      case None => store.limitedReport(load(filter)).map { value => cache.put(filter, value); value }

  private def load(f: TrafficFilter): Fu[JsObject] =
    // Calendar-aligned month ranges use monthly summaries. Boundary months use daily summaries.
    val monthAligned =
      TrafficTime.bucket(f.from, "month") == f.from && TrafficTime.bucket(f.until, "month") == f.until
    val grain = if f.grain == "hour" then "hour"
    else if Set("month", "year")(f.grain) && monthAligned then "month"
    else "day"
    val select =
      $doc("grain" -> grain, "dimension" -> f.dimension, "at" -> $doc("$gte" -> f.from, "$lt" -> f.until)) ++
        f.key.fold($empty)(key => $doc("key" -> key)) ++ f.registered.fold($empty)(registered =>
          $doc("registered" -> registered, "global" -> false)
        )
    for
      rows <- store.rollups(
        _.find(select).sort($sort.asc("at")).maxTimeMs(3000).cursor[TrafficRollup]().list(20001)
      )
      _ <-
        if rows.size > 20000 then
          fufail[Unit]("This report is too large. Select a category or a narrower period.")
        else funit
      status <- store.status
      catalog <- store.historicalCatalog
      baseline <-
        if f.dimension != "all" || f.key.isDefined || f.registered.contains(false) then fuccess(0L)
        else
          val month = TrafficTime.bucket(f.from, "month")
          store
            .rollups(
              _.find(
                $doc(
                  "dimension" -> "all",
                  "registered" -> true,
                  "$or" -> List(
                    $doc("grain" -> "month", "at" -> $doc("$lt" -> month)),
                    $doc("grain" -> "day", "at" -> $doc("$gte" -> month, "$lt" -> f.from))
                  )
                )
              ).maxTimeMs(3000).cursor[TrafficRollup]().list(20001)
            )
            .map: before =>
              require(before.size <= 20000, "Registration baseline exceeds the report budget")
              before.map(_.counts.getOrElse("user_registered", 0L)).sum
    yield
      def reportable(group: List[TrafficRollup]): Boolean =
        f.dimension != "city" || TrafficDistinct.union(group.map(_.visitors)).getLowerBound(2) >= 10
      val timeline = rows
        .groupBy(r => TrafficTime.bucket(r.at, f.grain))
        .toList
        .sortBy(_._1)
        .filter((_, group) => reportable(group))
        .map: (at, group) =>
          summarize(group) ++ Json.obj("at" -> at.toString)
      val groups = rows
        .groupBy(_.key)
        .toList
        .filter((_, group) => reportable(group))
        .map: (key, group) =>
          summarize(group) ++ Json.obj("key" -> key)
      Json.obj(
        "from" -> f.from.toString,
        "until" -> f.until.toString,
        "grain" -> f.grain,
        "dimension" -> f.dimension,
        "timezone" -> "UTC",
        "summary" -> summarize(if reportable(rows) then rows else Nil),
        "registrationBaseline" -> baseline,
        "smallCellsSuppressed" -> (f.dimension == "city"),
        "series" -> timeline,
        "groups" -> groups,
        "quality" -> status,
        "catalog" -> catalog
      )

  private def summarize(rows: List[TrafficRollup]): JsObject =
    val counts = rows.flatMap(_.counts).groupMapReduce(_._1)(_._2)(_ + _)
    val visitors = TrafficDistinct.union(rows.map(_.visitors))
    val sessions = TrafficDistinct.union(rows.map(_.sessions))
    val participants = TrafficDistinct.union(rows.map(_.participants))
    Json.obj(
      "counts" -> counts,
      "visitors" -> math.round(visitors.getEstimate),
      "visitorsLower" -> math.floor(visitors.getLowerBound(2)).toLong,
      "visitorsUpper" -> math.ceil(visitors.getUpperBound(2)).toLong,
      "sessions" -> math.round(sessions.getEstimate),
      "participants" -> math.round(participants.getEstimate),
      "waitP50" -> TrafficMetrics.percentile(counts, "search_paired", 0.5),
      "waitP90" -> TrafficMetrics.percentile(counts, "search_paired", 0.9),
      "waitP95" -> TrafficMetrics.percentile(counts, "search_paired", 0.95)
    )
