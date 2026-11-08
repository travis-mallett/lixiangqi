package lila.core

/** Account names use ASCII and unified Han ideographs, including supplementary planes. Compatibility
  * ideographs, combining marks and invisible characters are deliberately excluded: accepted names have a
  * stable spelling without runtime-dependent Unicode normalization.
  */
object UsernameRules:
  val han =
    "\\x{3007}\\x{3400}-\\x{4DBF}\\x{4E00}-\\x{9FFF}\\x{20000}-\\x{2A6DF}\\x{2A700}-\\x{2B73F}\\x{2B740}-\\x{2B81F}\\x{2B820}-\\x{2CEAF}\\x{2CEB0}-\\x{2EBEF}\\x{2EBF0}-\\x{2EE5F}\\x{30000}-\\x{3134F}\\x{31350}-\\x{323AF}"
  val letters = s"a-zA-Z$han"
  val characters = s"${letters}0-9_-"
  val existing = s"[$characters]{2,30}".r
  val signup = s"(?!.*[_-]{2})[$letters][$characters]{0,18}[${letters}0-9]".r
  val prefix = s"^[$letters].*".r
  val suffix = s".*[${letters}0-9]$$".r
  val chars = s"^[$characters]*$$".r
  val separators = s"^([${letters}0-9][_-]?)+$$".r
  val search = s"[$characters]{2,30}".r
  def length(value: String): Int = value.codePointCount(0, value.length)
  def take(value: String, max: Int): String =
    value.take(value.offsetByCodePoints(0, math.max(0, math.min(max, length(value)))))
  def id(value: String): String = value.toLowerCase(java.util.Locale.ROOT)
