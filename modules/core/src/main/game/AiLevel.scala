package lila.core.game

/** Public computer difficulty range, shared by setup and game search. */
object AiLevel:
  val levels = (1 to 720).toList

  /** The ten main setup choices, displayed as difficulty 0 through 9. */
  val customLevels = List(1, 9, 98, 187, 276, 364, 453, 542, 631, 720)

  def engineName(banqi: Boolean): String = if banqi then "BanqiFish" else "Pikafish"

  def name(level: Int, banqi: Boolean = false): Option[String] =
    Option.when(level >= 1 && level <= (if banqi then 10 else 720))(s"${engineName(banqi)} level $level")

  def displayName(level: Int): String = displayName(level, banqi = false)
  def displayName(level: Int, banqi: Boolean): String = name(level, banqi).getOrElse(s"AI level $level")
