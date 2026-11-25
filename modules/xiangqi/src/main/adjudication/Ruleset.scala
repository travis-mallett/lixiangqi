package lila.xiangqi.adjudication

/** Versioned game semantics, independent of time controls and board variants. */
enum Ruleset(val key: String, val label: String):
  case Tiantian extends Ruleset("tiantian-v1", "Tiantian")
  case Unrestricted extends Ruleset("unrestricted-v1", "Unrestricted (no repetition adjudication)")
  case Jieqi extends Ruleset("jieqi-v1", "Jieqi")

  case Banqi extends Ruleset("banqi-taiwan-2014-v1", "Banqi (Taiwan 2014)")
  case MiniXiangqi extends Ruleset("minixiangqi-v1", "Mini Xiangqi")
  case Manchu extends Ruleset("manchu-v1", "Manchu+")
  case ThreeKingdoms extends Ruleset("threeKingdoms-v1", "Three Kingdoms")

  def policy: Option[AdjudicationPolicy] = this match
    case Tiantian => Some(TiantianRules)
    case Unrestricted => None
    case Jieqi => Some(JieqiRules)
    case MiniXiangqi => Some(lila.xiangqi.MiniXiangqiRules)
    case Manchu => Some(lila.xiangqi.ManchuRules)
    case Banqi => None // The public Banqi position owns terminal decisions.
    case ThreeKingdoms => None // Adjudicated by the three-participant rules core.

object Ruleset:
  val default = Ruleset.Tiantian
  def fromKey(key: String): Either[String, Ruleset] =
    Ruleset.values.find(_.key == key).toRight(s"Unsupported Xiangqi ruleset: $key")
