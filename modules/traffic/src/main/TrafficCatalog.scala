package lila.traffic

import play.api.libs.json.*

import lila.pref.*

/** Values come from their owning catalogs. Adding an option never requires a traffic code change. */
object TrafficCatalog:
  val choices: Map[String, Map[String, String]] = Map(
    "board" -> BoardThemes.all.map(v => v.key -> v.name).toMap,
    "pieces" -> PieceSets.all.map(v => v.key -> v.name).toMap,
    "uiTheme" -> UiThemes.all.map(v => v.key -> v.name).toMap,
    "background" -> (Backgrounds.all.map(v => v.key -> v.name).toMap + (Backgrounds.customKey -> "Custom")),
    "sound" -> SoundSets.all.map(v => v.key -> v.name).toMap,
    "music" -> MusicSets.all.map(v => v.key -> v.name).toMap
  )

  def appearance(a: Appearance): Map[String, String] = Map(
    "board" -> a.boardTheme,
    "pieces" -> a.pieceSet,
    "uiTheme" -> a.uiTheme,
    "background" -> a.background,
    "sound" -> a.soundSet,
    "music" -> a.musicSet
  )

  val clientKinds: Set[String] = Set(
    "page",
    "attention",
    "visit.closed",
    "cta.exposed",
    "cta.clicked",
    "room.entered",
    "search.clicked",
    "search.cancelled",
    "search.failed",
    "round.ready",
    "round.failed",
    "puzzle.presented",
    "puzzle.started",
    "puzzle.retry",
    "puzzle.revealed",
    "puzzle.review",
    "puzzle.next",
    "lesson.started",
    "lesson.practice",
    "lesson.completed",
    "notation.started",
    "notation.finished",
    "appearance.changed",
    "audio.changed",
    "performance",
    "client.error"
  )
  val valueLimits: Map[String, Long] = Map(
    "visibleMs" -> 120000L,
    "engagedMs" -> 120000L,
    "boardMs" -> 120000L,
    "solvingMs" -> 120000L,
    "musicEnabledMs" -> 120000L,
    "effectsEnabledMs" -> 120000L,
    "musicPlayingMs" -> 120000L,
    "durationMs" -> 86400000L,
    "score" -> 100000L,
    "lcpMs" -> 120000L,
    "inpMs" -> 120000L,
    "clsMilli" -> 100000L,
    "quickExit" -> 1L,
    "selectedUseMs" -> 1000000000000L,
    "selectionEpisodes" -> 1L
  )
  val dimensionKeys: Set[String] = Set(
    "page",
    "previousPage",
    "activity",
    "language",
    "device",
    "referrer",
    "campaign",
    "source",
    "medium",
    "pool",
    "theme",
    "difficulty",
    "mode",
    "outcome",
    "placement",
    "colorScheme",
    "error",
    "musicEnabled",
    "effectsEnabled",
    "musicPlaying",
    "volume",
    "board",
    "pieces",
    "uiTheme",
    "background",
    "sound",
    "music",
    "previous",
    "component",
    "release"
  )

  private val safeKey = "[a-zA-Z0-9_.:+@/\\-]{1,100}".r
  def safe(value: String): Boolean = safeKey.matches(value)
  def validDimensions(d: Map[String, String]): Boolean =
    d.size <= dimensionKeys.size && d.forall: (key, value) =>
      dimensionKeys(key) && safe(value) && choices.get(key).forall(_.contains(value))

  def json: JsObject = Json.obj("appearance" -> choices, "events" -> clientKinds.toList.sorted)
