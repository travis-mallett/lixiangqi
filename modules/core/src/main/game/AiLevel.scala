package lila.core.game

/** Public computer difficulty range, shared by setup and game search. */
object AiLevel:
  val levels = (1 to 720).toList

  def name(level: Int): Option[String] =
    Option.when(level >= 1 && level <= 720)(s"Pikafish level $level")

  def displayName(level: Int): String = name(level).getOrElse(s"AI level $level")
