package lila.traffic

import play.api.libs.json.*
import lila.db.dsl.{ *, given }

/** These queries use bounded indexed facts, never scan the indefinitely retained journal. */
final class TrafficCohorts(store: TrafficStore)(using Executor):
  def searches(filter: TrafficFilter): Fu[JsObject] =
    val selector = $doc("stages.search_accepted" -> $doc("$gte" -> filter.from, "$lt" -> filter.until)) ++
      filter.registered.fold($empty)(value => $doc("registered" -> value)) ++
      filter.key
        .filter(_ => filter.dimension == "pool")
        .fold($empty)(value => $doc("dimensions.pool" -> value))
    for
      rows <- store.attempts(_.find(selector).maxTimeMs(3000).cursor[Bdoc]().list(20001))
      _ <-
        if rows.size <= 20000 then funit
        else fufail[Unit]("This cohort is too large. Narrow the period or select a time control.")
      ids = rows.flatMap(_.getAsOpt[String]("game")).distinct
      games <- ids.nonEmpty.so(store.games(_.find($inIds(ids)).maxTimeMs(3000).cursor[Bdoc]().list(ids.size)))
    yield
      val gameById = games.flatMap(g => g.getAsOpt[String]("_id").map(_ -> g)).toMap
      def stages(row: Bdoc) = row.getAsOpt[Bdoc]("stages").getOrElse($empty)
      val paired = rows.filter(r => stages(r).getAsOpt[Instant]("search_paired").isDefined)
      val left = rows.count(r =>
        stages(r).getAsOpt[Instant]("search_paired").isEmpty && stages(r)
          .getAsOpt[Instant]("search_left")
          .isDefined
      )
      val waits = paired.flatMap: row =>
        val s = stages(row)
        for start <- s.getAsOpt[Instant]("search_accepted"); end <- s.getAsOpt[Instant]("search_paired")
        yield math.max(0L, java.time.Duration.between(start, end).toMillis)
      def percentile(fraction: Double) = Option.when(waits.nonEmpty)(
        waits.sorted.apply(math.max(0, math.ceil(waits.size * fraction).toInt - 1))
      )
      Json.obj(
        "accepted" -> rows.size,
        "paired" -> paired.size,
        "left" -> left,
        "roundReady" -> paired.count(r => stages(r).getAsOpt[Instant]("round_ready").isDefined),
        "firstMove" -> paired.count(r =>
          r.getAsOpt[String]("game")
            .flatMap(gameById.get)
            .exists(_.getAsOpt[Instant]("game_firstMove").isDefined)
        ),
        "aborted" -> paired.count(r =>
          r.getAsOpt[String]("game")
            .flatMap(gameById.get)
            .exists(_.getAsOpt[String]("outcome").contains("aborted"))
        ),
        "unresolved" -> (rows.size - paired.size - left),
        "asOf" -> nowInstant.toString,
        "waitP50" -> percentile(0.5),
        "waitP90" -> percentile(0.9),
        "waitP95" -> percentile(0.95)
      )

  def returns(filter: TrafficFilter): Fu[JsObject] =
    for
      schema <- store.state(_.one[Bdoc]($id("schema")))
      coverageFrom = schema.flatMap(_.getAsOpt[Instant]("installedAt")).getOrElse(java.time.Instant.EPOCH)
      from = if filter.from.isBefore(coverageFrom) then coverageFrom else filter.from
      accounts <- store.subjects(
        _.find($doc("registeredAt" -> $doc("$gte" -> from, "$lt" -> filter.until)))
          .maxTimeMs(3000)
          .cursor[Bdoc]()
          .list(10001)
      )
      _ <-
        if accounts.size > 10000 then
          fufail[Unit]("This signup cohort is too large. Select a shorter period.")
        else funit
      created = accounts
        .flatMap(row =>
          for id <- row.getAsOpt[String]("_id"); at <- row.getAsOpt[Instant]("registeredAt")
          yield id -> TrafficTime.bucket(at, "day")
        )
        .toMap
      ids = created.toList.flatMap((id, day) =>
        List(1, 7, 30).map(offset => s"$id/${day.plusSeconds(offset * 86400L)}")
      )
      facts <- ids.nonEmpty.so(store.facts(_.find($inIds(ids)).maxTimeMs(3000).cursor[Bdoc]().list(ids.size)))
    yield
      val meaningful = Set("puzzle_completed", "user_gameCompleted", "notation_finished", "lesson_completed")
      val active = facts
        .filter(
          _.getAsOpt[Map[String, Long]]("counts")
            .exists(_.exists((key, count) => meaningful(key) && count > 0))
        )
        .flatMap(_.getAsOpt[String]("_id"))
        .toSet
      val returns = List(1, 7, 30).map: offset =>
        val mature = created.filter((_, day) => !day.plusSeconds((offset + 1L) * 86400).isAfter(nowInstant))
        val observed = mature.count((id, day) => active(s"$id/${day.plusSeconds(offset * 86400L)}"))
        Json.obj(
          "day" -> offset,
          "eligible" -> mature.size,
          "returned" -> Option.when(mature.size >= 10)(observed)
        )
      Json.obj(
        "size" -> accounts.size,
        "activated" -> Option.when(accounts.size >= 10)(
          accounts.count(_.getAsOpt[Instant]("firstActivityAt").isDefined)
        ),
        "coverageFrom" -> coverageFrom.toString,
        "returns" -> returns
      )

  def audio(): Fu[JsObject] =
    store
      .browsers(
        _.find($doc("at" -> $doc("$gte" -> nowInstant.minusSeconds(30L * 86400)), "registered" -> true))
          .maxTimeMs(3000)
          .cursor[Bdoc]()
          .list(50001)
      )
      .map: rows =>
        require(rows.size <= 50000, "Recent browser population exceeds the report budget")
        def isEnabled(row: Bdoc, component: String) =
          row.getAsOpt[Map[String, String]]("dimensions").exists(_.get(component).contains("true"))
        def enabled(component: String) =
          rows.count(isEnabled(_, component))
        val accounts = rows.groupBy(_.getAsOpt[String]("subject"))
        def enabledAccounts(component: String) = accounts.values.count(_.exists(isEnabled(_, component)))
        Json.obj(
          "browsers" -> rows.size,
          "users" -> accounts.size,
          "musicAccounts" -> enabledAccounts("musicEnabled"),
          "effectsAccounts" -> enabledAccounts("effectsEnabled"),
          "musicEnabled" -> enabled("musicEnabled"),
          "effectsEnabled" -> enabled("effectsEnabled")
        )
