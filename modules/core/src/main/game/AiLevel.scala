package lila.core.game

/** Stable default-language names for computer opponents in exports and request-independent game naming.
  *
  * The number is persisted on [[Player.aiLevel]] and is also used for statistics and engine configuration. It
  * is an internal profile id. Localized views use the corresponding aiLevel translation keys; the parity test
  * keeps these default names aligned with the source translations.
  */
object AiLevel:

  private val names = Vector(
    "Newcomer (小白)",
    "Rookie (菜鸟)",
    "Initiate (入门)",
    "Elementary (初级)",
    "Intermediate (中级)",
    "Advanced (高级)",
    "Elite (精英)",
    "Master (大师)",
    "Grandmaster (特级大师)"
  )

  /** Returns the product name for a valid persisted profile id. */
  def name(level: Int): Option[String] = names.lift(level - 1)

  /** Returns a stable name even for an unexpected legacy profile id. */
  def displayName(level: Int): String = name(level).getOrElse(s"AI level $level")
