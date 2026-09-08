package lila.xiangqi.adjudication

/** Versioned game semantics, independent of time controls and board variants. */
enum Ruleset(val key: String, val label: String):
  case Tiantian extends Ruleset("tiantian-v1", "Tiantian")
  case Unrestricted extends Ruleset("unrestricted-v1", "Unrestricted (no repetition adjudication)")

  def policy: Option[AdjudicationPolicy] = this match
    case Tiantian => Some(TiantianRules)
    case Unrestricted => None

object Ruleset:
  val default = Ruleset.Tiantian
  def fromKey(key: String): Either[String, Ruleset] =
    Ruleset.values.find(_.key == key).toRight(s"Unsupported Xiangqi ruleset: $key")
