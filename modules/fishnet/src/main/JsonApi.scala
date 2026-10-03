package lila.fishnet

import chess.eval.Eval.{ Cp, Mate }
import play.api.libs.json.*

import lila.common.Json.given
import lila.core.chess.Depth
import lila.fishnet.Work as W
import lila.xiangqi.Xiangqi
import lila.xiangqi.XiangqiJson.given

object JsonApi:

  sealed trait Request

  object Request:

    def isValid(js: JsValue): Boolean =
      js.arr("analysis").forall(_.value.sizeIs <= lila.xiangqi.UciPath.maxDepth + 1)

    case class Engine(name: String, version: String, nnue: Boolean)

    case class Acquire() extends Request

    case class PostAnalysis(
        engine: Engine,
        analysis: List[Option[Evaluation.EvalOrSkip]]
    ) extends Request:

      def completeOrPartial =
        if analysis.nonEmpty && analysis.forall(_.isDefined) then CompleteAnalysis(engine, analysis.flatten)
        else PartialAnalysis(engine, analysis)

    case class CompleteAnalysis(
        engine: Engine,
        analysis: List[Evaluation.EvalOrSkip]
    ):

      import Evaluation.*
      def evaluations = analysis.collect { case EvalOrSkip.Evaluated(e) => e }

      def medianNodes = scalalib.Maths.median:
        evaluations
          .withFilter(e => !(e.mateFound || e.deadDraw))
          .flatMap(_.nodes)

    case class PartialAnalysis(
        engine: Engine,
        analysis: List[Option[Evaluation.EvalOrSkip]]
    )

    case class Evaluation(
        pv: List[Xiangqi.Uci],
        score: Evaluation.Score,
        time: Option[Int],
        nodes: Option[Int],
        nps: Option[Int],
        depth: Option[Depth]
    ):
      val cappedNps = nps.map(_.min(Evaluation.npsCeil))

      val cappedPv = pv.take(lila.analyse.Info.LineMaxPlies)

      def isCheckmate = score.mate.has(Mate(0))
      def mateFound = score.mate.isDefined
      def deadDraw = score.cp.has(Cp(0))

    object Evaluation:

      enum EvalOrSkip:
        case Skipped
        case Evaluated(eval: Evaluation)

      case class Score(cp: Option[Cp], mate: Option[Mate]):
        def invert = copy(cp.map(_.invert), mate.map(_.invert))
        def invertIf(cond: Boolean) = if cond then invert else this

      val npsCeil = 10_000_000

  case class Game(
      game_id: String,
      position: String,
      moves: String,
      ruleset: String,
      positions: Vector[Position]
  )

  case class Position(legalMoves: Vector[Xiangqi.Uci], result: Xiangqi.Result, turn: Xiangqi.Side)

  def fromGame(g: W.Game) =
    Game(
      game_id = if g.studyId.isDefined then "" else g.id,
      position = g.initialFen.fold(Xiangqi.startFen)(_.value),
      moves = g.moves,
      ruleset = g.ruleset.key,
      positions = g.nativeGame.states.map(state => Position(state.legalMoves, state.gameResult, state.turn))
    )

  sealed trait Work:
    val id: String
    val game: Game

  case class Analysis(
      id: String,
      game: Game,
      nodes: Int,
      skipPositions: List[Int]
  ) extends Work

  def analysisFromWork(m: Work.Analysis): Analysis =
    Analysis(
      id = m.id.value,
      game = fromGame(m.game),
      nodes = m.nodesPerMove,
      skipPositions = m.skipPositions
    )

  object readers:
    import play.api.libs.functional.syntax.*
    import Request.Evaluation.EvalOrSkip
    given Reads[Request.Engine] = Json.reads
    given Reads[Request.Acquire] = Json.reads
    given Reads[Request.Evaluation.Score] = Json.reads
    given Reads[List[Xiangqi.Uci]] = Reads
      .of[String]
      .flatMapResult: moves =>
        moves
          .split(' ')
          .toList
          .filter(_.nonEmpty)
          .traverse(Xiangqi.Uci.from)
          .fold(JsError(_), JsSuccess(_))

    given EvaluationReads: Reads[Request.Evaluation] = (
      (__ \ "pv")
        .readNullable[List[Xiangqi.Uci]]
        .map(~_)
        .and((__ \ "score").read[Request.Evaluation.Score])
        .and((__ \ "time").readNullable[Int])
        .and((__ \ "nodes").readNullable[Long].map(_.map(_.toSaturatedInt)))
        .and((__ \ "nps").readNullable[Long].map(_.map(_.toSaturatedInt)))
        .and((__ \ "depth").readNullable[Depth])
    )(Request.Evaluation.apply)
    given Reads[Option[EvalOrSkip]] = Reads:
      case JsNull => JsSuccess(None)
      case obj =>
        if ~(obj.boolean("skipped")) then JsSuccess(EvalOrSkip.Skipped.some)
        else EvaluationReads.reads(obj).map(EvalOrSkip.Evaluated(_).some)
    given Reads[Request.PostAnalysis] = Json.reads

  object writers:
    given Writes[Position] = Json.writes
    given Writes[Game] = Json.writes
    given OWrites[Work] = OWrites { work =>
      (work match
        case a: Analysis =>
          Json.obj(
            "work" -> Json.obj(
              "type" -> "analysis",
              "id" -> a.id,
              "nodes" -> a.nodes,
              "timeout" -> Cleaner.timeoutPerPly.toMillis
            ),
            "skipPositions" -> a.skipPositions
          )
      ) ++ Json.toJson(work.game).as[JsObject]
    }
