package controllers

import scala.util.Random

import play.api.libs.json.Json
import play.api.mvc.Result

import lila.app.{ *, given }
import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.XiangqiJson.given

final class Notation(env: Env) extends LilaController(env):

  def home = Open(serveHome)
  def homeLang = LangPage(routes.Notation.home)(serveHome)

  private def serveHome(using ctx: Context): Fu[Result] =
    ctx.userId
      .so: userId =>
        env.notation.api.getScore(userId).map(_.some)
      .flatMap: score =>
        Ok.page(views.notation.show(score))

  def exercise(turn: Option[String]) = Open:
    requestedTurn(turn) match
      case Left(error) => fuccess(error)
      case Right(side) =>
        Found(env.puzzle.api.puzzle.random(side)): puzzle =>
          puzzle.stateAfterInitialMove
            .filter(state => side.forall(_ == state.turn))
            .flatMap: state =>
              Random
                .shuffle(state.legalMoves)
                .flatMap: move =>
                  for result <- XiangqiRules.move(Xiangqi.Position(initialFen = state.fen), move).toOption
                  yield Json.obj(
                    "fen" -> state.fen,
                    "turn" -> state.turn,
                    "legalMoves" -> state.legalMoves,
                    "move" -> move,
                    "resultFen" -> result.fen,
                    "wxf" -> result.notation,
                    "chinese" -> result.chineseNotation
                  )
                .headOption
            .fold(notFoundJson("No valid notation exercise is available"))(JsonOk(_))

  private def requestedTurn(turn: Option[String]): Either[Result, Option[Xiangqi.Side]] =
    turn match
      case None | Some("both") => Right(None)
      case Some("red") => Right(Some(Xiangqi.Side.Red))
      case Some("black") => Right(Some(Xiangqi.Side.Black))
      case Some(_) => Left(BadRequest(Json.obj("error" -> "Invalid Xiangqi side to move")))

  def score = AuthBody { ctx ?=> me ?=>
    bindForm(env.notation.forms.score)(
      _ => fuccess(BadRequest),
      data => env.notation.api.addScore(data.mode, data.perspective, data.score).inject(Ok(()))
    )
  }
