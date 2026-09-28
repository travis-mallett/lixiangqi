package lila.traffic

/** The same contributions feed every calendar granularity; no summed daily uniques or averaged percentiles.
  */
object TrafficMetrics:
  val timeMetrics = Set(
    "visibleMs",
    "engagedMs",
    "boardMs",
    "solvingMs",
    "musicEnabledMs",
    "effectsEnabledMs",
    "musicPlayingMs"
  )
  val breakdowns = Set(
    "all",
    "page",
    "activity",
    "country",
    "region",
    "city",
    "language",
    "device",
    "referrer",
    "campaign",
    "source",
    "medium",
    "pool",
    "theme",
    "difficulty",
    "outcome",
    "placement",
    "board",
    "pieces",
    "uiTheme",
    "background",
    "sound",
    "music",
    "boardPieces",
    "themeBackground",
    "combination",
    "musicEnabled",
    "effectsEnabled",
    "component",
    "transition",
    "mode",
    "error",
    "colorScheme"
  )
  val waitBounds: List[Long] =
    List(1000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1800000, 86400000)

  def counts(event: StoredEvent): Map[String, Long] =
    val prefix = event.kind.replace('.', '_')
    val base = Map(prefix -> 1L) ++ event.values.filter((key, _) =>
      timeMetrics(key) || Set(
        "score",
        "lcpMs",
        "inpMs",
        "clsMilli",
        "quickExit",
        "selectedUseMs",
        "selectionEpisodes"
      )(key)
    ) ++
      event.values.keys.filter(Set("lcpMs", "inpMs", "clsMilli")).map(key => s"${key}Count" -> 1L)
    event.values
      .get("durationMs")
      .fold(base): duration =>
        val index = waitBounds.indexWhere(_ >= duration) match
          case -1 => waitBounds.size - 1
          case i => i
        base ++ Map(
          s"${prefix}_durationMs" -> duration,
          s"${prefix}_durationCount" -> 1L,
          s"${prefix}_durationBucket$index" -> 1L
        )

  def dimensions(event: StoredEvent): Map[String, String] =
    val d = event.dimensions
    def pair(a: String, b: String): Option[String] = for x <- d.get(a); y <- d.get(b) yield s"$x|$y"
    Map("all" -> "all") ++ d.filter((key, _) => breakdowns(key)) ++
      pair("board", "pieces").map("boardPieces" -> _) ++
      pair("uiTheme", "background").map("themeBackground" -> _) ++
      (for component <- d.get("component"); previous <- d.get("previous"); current <- d.get(component)
      yield "transition" -> s"$component/$previous|$current") ++
      Option.when(event.kind == "attention"):
        "combination" -> List("uiTheme", "background", "board", "pieces", "sound", "music")
          .map(k => d.getOrElse(k, "unknown"))
          .mkString("|")

  def percentile(counts: Map[String, Long], prefix: String, fraction: Double): Option[Long] =
    val total = counts.getOrElse(s"${prefix}_durationCount", 0L)
    if total == 0 then None
    else
      var cumulative = 0L
      waitBounds.zipWithIndex
        .find: (_, index) =>
          cumulative += counts.getOrElse(s"${prefix}_durationBucket$index", 0L)
          cumulative >= math.ceil(total * fraction)
        .map(_._1)
