package lila.puzzle

import lila.common.Iso
import lila.core.i18n.I18nKey

sealed abstract class PuzzleAngle(val key: PuzzleAngle.Key):
  val name: I18nKey
  def description: I18nKey
  def asTheme: Option[PuzzleTheme.Key]
  def categ = this match
    case PuzzleAngle.Theme(PuzzleTheme.mix) => "mix"
    case PuzzleAngle.Theme(_) => "theme"

object PuzzleAngle:
  type Key = String
  case class Theme(theme: PuzzleTheme.Key) extends PuzzleAngle(theme.value):
    val name = PuzzleTheme(theme).name
    val description = PuzzleTheme(theme).description
    def asTheme = theme.some

  def apply(theme: PuzzleTheme): PuzzleAngle = Theme(theme.key)

  def find(key: Key): Option[PuzzleAngle] =
    PuzzleTheme.findVisible(key).map(apply)

  val mix: PuzzleAngle = apply(PuzzleTheme.mix)

  def findOrMix(key: Key): PuzzleAngle = find(key) | mix

  case class All(themes: List[(I18nKey, List[PuzzleTheme.WithCount])])

  given Iso.StringIso[PuzzleAngle] = scalalib.Iso.string(findOrMix, _.key)
