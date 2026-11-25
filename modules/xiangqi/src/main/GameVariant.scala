package lila.xiangqi

/** Native game identity, independent of adjudication revisions and legacy chess metadata. */
enum GameVariant(val key: String, val name: String, val nameKey: String):
  case Xiangqi extends GameVariant("xiangqi", "Xiangqi", "xiangqi")
  case Jieqi extends GameVariant("jieqi", "Jieqi", "jieqi")

  case Banqi extends GameVariant("banqi", "Banqi", "banqi")
  case MiniXiangqi extends GameVariant("minixiangqi", "Mini Xiangqi", "miniXiangqi")
  case Manchu extends GameVariant("manchu", "Manchu+", "manchu")
  case ThreeKingdoms extends GameVariant("threeKingdoms", "Game of the Three Kingdoms", "threeKingdoms")

  def playerCount: Int = if this == ThreeKingdoms then 3 else 2

  def symbol: String = this match
    case Xiangqi => "帥"
    case Jieqi => "揭"
    case Banqi => "暗"
    case MiniXiangqi => "迷"
    case Manchu => "旗"
    case ThreeKingdoms => "三"

  def files: Int = if this == MiniXiangqi then 7 else if this == Banqi then 4 else 9
  def ranks: Int = if this == MiniXiangqi then 7 else if this == Banqi then 8 else 10
  def startFen: String = this match
    case Xiangqi => lila.xiangqi.Xiangqi.startFen
    case Jieqi => lila.xiangqi.Jieqi.startFen
    case Banqi => lila.xiangqi.Banqi.startFen
    case MiniXiangqi => MiniXiangqiRules.startFen
    case Manchu => ManchuRules.startFen
    case ThreeKingdoms => lila.threeKingdoms.PositionCodec.write(lila.threeKingdoms.Position.initial)

  def supportsCustomPosition: Boolean = this != Jieqi && this != Banqi

  def selectableRulesets: List[adjudication.Ruleset] = this match
    case Xiangqi => List(adjudication.Ruleset.Tiantian, adjudication.Ruleset.Unrestricted)
    case Banqi | Jieqi | MiniXiangqi | Manchu | ThreeKingdoms => Nil

  def defaultRuleset: adjudication.Ruleset = this match
    case Xiangqi => adjudication.Ruleset.default
    case Jieqi => adjudication.Ruleset.Jieqi
    case Banqi => adjudication.Ruleset.Banqi
    case MiniXiangqi => adjudication.Ruleset.MiniXiangqi
    case Manchu => adjudication.Ruleset.Manchu
    case ThreeKingdoms => adjudication.Ruleset.ThreeKingdoms

  def supportsRuleset(ruleset: adjudication.Ruleset): Boolean =
    ruleset == defaultRuleset || selectableRulesets.contains(ruleset)

  def resolveRuleset(key: Option[String]): Either[String, adjudication.Ruleset] =
    key.fold[Either[String, adjudication.Ruleset]](Right(defaultRuleset)): value =>
      adjudication.Ruleset
        .fromKey(value)
        .flatMap: ruleset =>
          Either.cond(supportsRuleset(ruleset), ruleset, s"Invalid rules for $name")

  def validDuelPosition(fromPosition: Boolean, fen: Option[String]): Boolean =
    if playerCount != 2 then false
    else if fromPosition then
      supportsCustomPosition && fen.exists(value =>
        lila.xiangqi.Xiangqi.Fen.board(value).exists(_.variant == this)
      )
    else fen.forall(value => supportsCustomPosition && value == startFen)

  def initialGame(
      position: Option[String],
      ruleset: adjudication.Ruleset
  ): Either[String, lila.xiangqi.Xiangqi.Game] =
    if !supportsRuleset(ruleset) || !validDuelPosition(position.isDefined, position) then
      Left(s"Invalid position or rules for $name")
    else if this == Banqi then lila.xiangqi.Banqi.initial()
    else if this == Jieqi then lila.xiangqi.Jieqi.initial()
    else XiangqiRules.initialGame(Some(position.getOrElse(startFen)), ruleset)

object GameVariant:
  def fromKey(key: String): Either[String, GameVariant] =
    values.find(_.key == key).toRight(s"Unsupported game variant: $key")
