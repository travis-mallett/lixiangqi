package lila.round

import chess.Ply
import play.api.libs.json.*

import lila.common.Json.given
import lila.xiangqi.Xiangqi

case class Forecast(_id: GameFullId, steps: Forecast.Steps, date: Instant):

  def apply(g: Game, lastMove: Xiangqi.Uci): Option[(Forecast, Xiangqi.Uci)] =
    nextMove(g, lastMove).map { move =>
      copy(
        steps = steps.collect {
          case fst :: snd :: rest if rest.nonEmpty && g.ply == fst.ply && fst.is(lastMove) && snd.is(move) =>
            rest
        },
        date = nowInstant
      ) -> move
    }

  // accept up to 30 lines of 30 moves each
  def truncate = copy(steps = steps.take(30).map(_.take(30)))

  private def nextMove(g: Game, last: Xiangqi.Uci) =
    steps.collectFirstSome:
      case fst :: snd :: _ if g.ply == fst.ply && fst.is(last) => snd.uciMove
      case _ => none

object Forecast:

  type Steps = List[List[Step]]

  def maxPlies(steps: Steps): Int = steps.foldLeft(0)(_ max _.size)

  def isValid(js: JsValue): Boolean =
    js.asOpt[JsArray]
      .forall: lines =>
        lines.value.sizeIs <= 30 && lines.value.forall:
          _.asOpt[JsArray].forall(_.value.sizeIs <= 30)

  case class Step(
      ply: Ply,
      uci: String,
      san: String,
      fen: String,
      check: Option[Boolean]
  ):

    def is(move: Xiangqi.Uci) = move.value == uci

    def uciMove = Xiangqi.Uci.from(uci).toOption

  given Format[Step] = Json.format
  given Writes[Forecast] = Json.writes

  case object OutOfSync extends lila.core.lilaism.LilaException:
    val message = "Forecast out of sync"
