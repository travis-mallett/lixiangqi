package lila.xiangqi

/** Native game identity, independent of adjudication revisions and legacy chess metadata. */
enum GameVariant(val key: String, val name: String, val nameKey: String):
  case Xiangqi extends GameVariant("xiangqi", "Xiangqi", "xiangqi")
  case Jieqi extends GameVariant("jieqi", "Jieqi", "jieqi")

  case MiniXiangqi extends GameVariant("minixiangqi", "Mini Xiangqi", "miniXiangqi")
  case Manchu extends GameVariant("manchu", "Manchu+", "manchu")
  case ThreeKingdoms extends GameVariant("threeKingdoms", "Game of the Three Kingdoms", "threeKingdoms")

  def playerCount: Int = if this == ThreeKingdoms then 3 else 2

  def symbol: String = this match
    case Xiangqi => "帥"
    case Jieqi => "揭"
    case MiniXiangqi => "迷"
    case Manchu => "旗"
    case ThreeKingdoms => "三"

  def files: Int = if this == MiniXiangqi then 7 else 9
  def ranks: Int = if this == MiniXiangqi then 7 else 10
  def startFen: String = this match
    case Xiangqi => lila.xiangqi.Xiangqi.startFen
    case Jieqi => lila.xiangqi.Jieqi.startFen
    case MiniXiangqi => MiniXiangqiRules.startFen
    case Manchu => ManchuRules.startFen
    case ThreeKingdoms => lila.threeKingdoms.PositionCodec.write(lila.threeKingdoms.Position.initial)

  def supportsCustomPosition: Boolean = this != Jieqi

  def selectableRulesets: List[adjudication.Ruleset] = this match
    case Xiangqi => List(adjudication.Ruleset.Tiantian, adjudication.Ruleset.Unrestricted)
    case Jieqi | MiniXiangqi | Manchu | ThreeKingdoms => Nil

  def defaultRuleset: adjudication.Ruleset = this match
    case Xiangqi => adjudication.Ruleset.default
    case Jieqi => adjudication.Ruleset.Jieqi
    case MiniXiangqi => adjudication.Ruleset.MiniXiangqi
    case Manchu => adjudication.Ruleset.Manchu
    case ThreeKingdoms => adjudication.Ruleset.ThreeKingdoms

  def initialGame(
      position: Option[String],
      ruleset: adjudication.Ruleset
  ): Either[String, lila.xiangqi.Xiangqi.Game] =
    this match
      case Xiangqi
          if selectableRulesets.contains(ruleset) && position
            .forall(fen => lila.xiangqi.Xiangqi.Fen.board(fen).exists(_.variant == this)) =>
        XiangqiRules.initialGame(position, ruleset)
      case Jieqi if position.isEmpty && ruleset == defaultRuleset => lila.xiangqi.Jieqi.initial()
      case MiniXiangqi | Manchu if ruleset == defaultRuleset =>
        val fen = position.getOrElse(startFen)
        if lila.xiangqi.Xiangqi.Fen.board(fen).exists(_.variant == this) then
          XiangqiRules.initialGame(Some(fen), ruleset)
        else Left(s"Invalid $name position")
      case _ => Left(s"Invalid position or rules for $name")

object GameVariant:
  def fromKey(key: String): Either[String, GameVariant] =
    values.find(_.key == key).toRight(s"Unsupported game variant: $key")
