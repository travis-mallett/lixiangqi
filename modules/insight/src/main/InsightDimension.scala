package lila.insight

import chess.eval.WinPercent
import play.api.libs.json.*
import reactivemongo.api.bson.*

import lila.analyse.AccuracyPercent
import lila.core.i18n.Translate
import lila.db.dsl.{ *, given }
import lila.insight.BSONHandlers.given
import lila.insight.InsightEntry.BSONFields as F
import lila.rating.BSONHandlers.perfTypeIdHandler
import lila.game.BSONHandlers.sourceHandler
import lila.rating.PerfType
import lila.core.game.Source
import lila.xiangqi.Xiangqi

enum InsightDimension[A](
    val key: String,
    val name: String,
    val dbKey: String,
    val position: InsightPosition,
    val description: String
)(using val bson: BSONHandler[A]):
  def isInGame = position == InsightPosition.Game
  def isInMove = position == InsightPosition.Move

  case Period
      extends InsightDimension[Period](
        "period",
        "Date",
        F.date,
        InsightPosition.Game,
        "The date at which the game was played"
      )

  case Date
      extends InsightDimension[lila.insight.DateRange](
        "date",
        "Date",
        F.date,
        InsightPosition.Game,
        "The date at which the game was played"
      )

  case Perf
      extends InsightDimension[PerfType](
        "variant",
        "Variant",
        F.perf,
        InsightPosition.Game,
        "The Xiangqi rating category of the game, like Bullet, Blitz, or Rapid."
      )

  case Phase
      extends InsightDimension[Phase](
        "phase",
        "Game phase",
        F.moves("p"),
        InsightPosition.Move,
        "The portion of the game: Opening, Middlegame, or Endgame."
      )

  case Result
      extends InsightDimension[Result](
        "result",
        "Game result",
        F.result,
        InsightPosition.Game,
        "Whether you won, lost, or drew the game."
      )

  case Termination
      extends InsightDimension[Termination](
        "termination",
        "Game termination",
        F.termination,
        InsightPosition.Game,
        "The way that the game ended, like Checkmate or Resignation."
      )

  case Color
      extends InsightDimension[Color](
        "color",
        "Color",
        F.color,
        InsightPosition.Game,
        "The side you are playing: Red or Black."
      )

  case OpponentStrength
      extends InsightDimension[RelativeStrength](
        "opponentStrength",
        "Opponent strength",
        F.opponentStrength,
        InsightPosition.Game,
        "Rating of your opponent compared to yours. Much weaker:-200, Weaker:-100, Stronger:+100, Much stronger:+200."
      )

  case PieceRole
      extends InsightDimension[Xiangqi.Role](
        "piece",
        "Piece moved",
        F.moves("r"),
        InsightPosition.Move,
        "The type of piece you move."
      )

  case MovetimeRange
      extends InsightDimension[MovetimeRange](
        "movetime",
        "Move time",
        F.moves("t"),
        InsightPosition.Move,
        "The amount of time you spend thinking on each move, in seconds."
      )

  case MaterialRange
      extends InsightDimension[MaterialRange](
        "material",
        "Material imbalance",
        F.moves("i"),
        InsightPosition.Move,
        "Value of your pieces compared to your opponent's. Soldier=1, Advisor/Elephant=2, Horse=4, Cannon=5, Chariot=9."
      )

  case Blur
      extends InsightDimension[Blur](
        "blur",
        "Move blur",
        F.moves("b"),
        InsightPosition.Move,
        "Whether a window blur happened before that move or not."
      )

  case TimeVariance
      extends InsightDimension[TimeVariance](
        "timeVariance",
        "Time variance",
        F.moves("v"),
        InsightPosition.Move,
        "Move time variance. Very consistent: < 0.25, Consistent: < 0.4, Medium, Variable: > 0.6, Very variable > 0.75."
      )

  case CplRange
      extends InsightDimension[CplRange](
        "cpl",
        "Centipawn loss",
        F.moves("c"),
        InsightPosition.Move,
        "Centipawns lost by each move, according to Pikafish evaluation."
      )

  case EvalRange
      extends InsightDimension[EvalRange](
        "eval",
        "Evaluation",
        F.moves("e"),
        InsightPosition.Move,
        "Pikafish evaluation of the position, relative to the player, in centipawns."
      )

  case AccuracyPercentRange
      extends InsightDimension[AccuracyPercentRange](
        "accuracy",
        "Accuracy",
        F.moves("a"),
        InsightPosition.Move,
        """How accurate your moves are, based on Pikafish evaluation."""
      )

  case WinPercentRange
      extends InsightDimension[WinPercentRange](
        "winPercent",
        "Winning chances",
        F.moves("w"),
        InsightPosition.Move,
        "Chances to win a position, based on Pikafish evaluation. A.k.a. Win%"
      )

  case ClockPercentRange
      extends InsightDimension[ClockPercentRange](
        "clockPercent",
        "Time pressure",
        F.moves("s"),
        InsightPosition.Move,
        "Time left on the player clock, accounting for increment. 100% = full clock, 0% = flagging."
      )

  case GameSource
      extends InsightDimension[Source](
        "source",
        "Game source",
        F.source,
        InsightPosition.Game,
        "How the game was created."
      )

object InsightDimension:

  def requiresStableRating(d: InsightDimension[?]) = d match
    case OpponentStrength => true
    case _ => false

  def valuesOf[X](d: InsightDimension[X]): Seq[X] = d match
    case Period => lila.insight.Period.selector
    case Date => Nil // Period is used instead
    case Perf => lila.rating.PerfType.nonPuzzle
    case Phase => lila.insight.Phase.values.toIndexedSeq
    case Result => lila.insight.Result.values.toIndexedSeq
    case Termination => lila.insight.Termination.values.toIndexedSeq
    case Color => lila.insight.Color.values.toIndexedSeq
    case OpponentStrength => RelativeStrength.values.toIndexedSeq
    case PieceRole => Xiangqi.Role.values.toIndexedSeq
    case MovetimeRange => lila.insight.MovetimeRange.values.toIndexedSeq
    case CplRange => lila.insight.CplRange.all
    case AccuracyPercentRange => lila.insight.AccuracyPercentRange.all.toList
    case MaterialRange => lila.insight.MaterialRange.values.toIndexedSeq
    case EvalRange => lila.insight.EvalRange.values.toIndexedSeq
    case WinPercentRange => lila.insight.WinPercentRange.all.toList
    case ClockPercentRange => lila.insight.ClockPercentRange.all.toList
    case Blur => lila.insight.Blur.values.toIndexedSeq
    case TimeVariance => lila.insight.TimeVariance.values.toIndexedSeq
    case GameSource =>
      Source.values.toIndexedSeq.filter:
        case Source.Ai | Source.Import | Source.ImportLive => false
        case _ => true

  def valueByKey[X](d: InsightDimension[X], key: String): Option[X] = d match
    case Period => key.toIntOption.map(lila.insight.Period.apply)
    case Date => None
    case Perf => PerfKey(key).map(PerfType.apply)
    case Phase => key.toIntOption.flatMap(lila.insight.Phase.byId.get)
    case Result => key.toIntOption.flatMap(lila.insight.Result.byId.get)
    case Termination => key.toIntOption.flatMap(lila.insight.Termination.byId.get)
    case Color =>
      key match
        case "red" => chess.Color.White.some
        case "black" => chess.Color.Black.some
        case _ => none
    case OpponentStrength => key.toIntOption.flatMap(RelativeStrength.byId.get)
    case PieceRole => Xiangqi.Role.byKey.get(key)
    case MovetimeRange => key.toIntOption.flatMap(lila.insight.MovetimeRange.byId.get)
    case CplRange => key.toIntOption.flatMap(lila.insight.CplRange.byId.get)
    case AccuracyPercentRange => key.toIntOption.flatMap(lila.insight.AccuracyPercentRange.byPercent.get)
    case MaterialRange => key.toIntOption.flatMap(lila.insight.MaterialRange.byId.get)
    case EvalRange => key.toIntOption.flatMap(lila.insight.EvalRange.byId.get)
    case WinPercentRange => key.toIntOption.flatMap(lila.insight.WinPercentRange.byPercent.get)
    case ClockPercentRange => key.toIntOption.flatMap(lila.insight.ClockPercentRange.byPercent.get)
    case Blur => lila.insight.Blur(key == "true").some
    case TimeVariance => key.toFloatOption.map(lila.insight.TimeVariance.byId)
    case GameSource => Source.byName.get(key)

  def valueToJson[X](d: InsightDimension[X])(v: X)(using Translate): JsObject =
    Json.obj(
      "key" -> valueKey(d)(v),
      "name" -> valueJson(d)(v)
    )

  def valueKey[X](d: InsightDimension[X])(v: X): String =
    d.match
      case Date => v.toString
      case Period => v.days.toString
      case Perf => v.key
      case Phase => v.id
      case Result => v.id
      case Termination => v.id
      case Color => if v.white then "red" else "black"
      case OpponentStrength => v.id
      case PieceRole => v.key
      case MovetimeRange => v.id
      case CplRange => v.cpl
      case AccuracyPercentRange => v.bottom.toInt
      case MaterialRange => v.id
      case EvalRange => v.id
      case WinPercentRange => v.bottom.toInt
      case ClockPercentRange => v.bottom.toInt
      case Blur => v.id
      case TimeVariance => v.id
      case GameSource => v.name
    .toString

  def valueJson[X](d: InsightDimension[X])(v: X)(using Translate): JsValue =
    d match
      case Date => JsNumber(v.min.toSeconds)
      case Period => JsString(v.toString)
      case Perf => JsString(v.trans)
      case Phase => JsString(v.name)
      case Result => JsString(v.name)
      case Termination => JsString(v.name)
      case Color => JsString(if v.white then "Red" else "Black")
      case OpponentStrength => JsString(v.name)
      case PieceRole => JsString(v.name)
      case MovetimeRange => JsString(v.name)
      case CplRange => JsString(v.name)
      case AccuracyPercentRange => JsString(v.name)
      case MaterialRange => JsString(v.name)
      case EvalRange => JsString(v.name)
      case WinPercentRange => JsString(v.name)
      case ClockPercentRange => JsString(v.name)
      case Blur => JsString(v.name)
      case TimeVariance => JsString(v.name)
      case GameSource => JsString(v.toString)

  def filtersOf[X](d: InsightDimension[X], selected: List[X]): Bdoc =

    def percentRange[V: BSONWriter](toRange: X => (V, V), fromPercent: Int => V) = selected match
      case Nil => $empty
      case many =>
        $doc(
          "$or" -> many.map(toRange).map {
            case (min, max) if min == fromPercent(0) => $doc(d.dbKey.$lt(max))
            case (min, max) if max == fromPercent(100) => $doc(d.dbKey.$gte(min)) // hole at 90%? #TODO
            case (min, max) => $doc(d.dbKey.$gte(min).$lt(max))
          }
        )
    d match
      case InsightDimension.MovetimeRange =>
        selected match
          case Nil => $empty
          case many =>
            $doc(
              "$or" -> many.map(lila.insight.MovetimeRange.toRange).map { range =>
                $doc(d.dbKey.$gte(range._1).$lt(range._2))
              }
            )
      case InsightDimension.Period =>
        selected.maximumByOption(_.days).fold($empty) { period =>
          $doc(d.dbKey.$gt(period.min))
        }
      case InsightDimension.Date => // for tutor config date range filtering
        selected match
          case List(range) => $doc(d.dbKey.$gt(range.min).$lte(range.max))
          case _ => $empty
      case InsightDimension.MaterialRange =>
        selected match
          case Nil => $empty
          case many =>
            $doc(
              "$or" -> many.map { range =>
                val intRange = lila.insight.MaterialRange.toRange(range)
                if intRange._1 == intRange._2 then $doc(d.dbKey -> intRange._1)
                else if range.negative then $doc(d.dbKey.$gte(intRange._1).$lt(intRange._2))
                else $doc(d.dbKey.$gt(intRange._1).$lte(intRange._2))
              }
            )
      case InsightDimension.EvalRange =>
        selected match
          case Nil => $empty
          case many =>
            $doc(
              "$or" -> many.map { range =>
                val intRange = lila.insight.EvalRange.toRange(range)
                if range.eval < 0 then $doc(d.dbKey.$gte(intRange._1).$lt(intRange._2))
                else $doc(d.dbKey.$gt(intRange._1).$lte(intRange._2))
              }
            )
      case InsightDimension.WinPercentRange =>
        percentRange(lila.insight.WinPercentRange.toRange, WinPercent.fromPercent(_))
      case InsightDimension.AccuracyPercentRange =>
        percentRange(lila.insight.AccuracyPercentRange.toRange, AccuracyPercent.fromPercent(_))
      case InsightDimension.ClockPercentRange =>
        percentRange(lila.insight.ClockPercentRange.toRange, ClockPercent.fromPercent(_))
      case InsightDimension.TimeVariance =>
        selected match
          case Nil => $empty
          case many =>
            $doc(
              "$or" -> many.map(lila.insight.TimeVariance.toRange).map { range =>
                $doc(d.dbKey.$gt(range._1).$lte(range._2))
              }
            )
      case _ =>
        selected.flatMap(d.bson.writeOpt) match
          case Nil => $empty
          case List(x) => $doc(d.dbKey -> x)
          case xs => d.dbKey.$in(xs)

  def requiresAnalysis(d: InsightDimension[?]) =
    d match
      case CplRange => true
      case AccuracyPercentRange => true
      case EvalRange => true
      case WinPercentRange => true
      case _ => false

  def dataTypeOf[X](d: InsightDimension[X]): String =
    d match
      case Date => "date"
      case _ => "text"

  // these are not always present in an insight entry
  val optionalDimensions = List[InsightDimension[?]](OpponentStrength)
