package lila.game

import chess.format.BoardFen

import scala.util.Success

import lila.core.captcha.{ Captcha, CaptchaApi as ICaptchaApi, Solutions, WithCaptcha }
import lila.core.game.Game
import lila.mon.extensions.*
import lila.xiangqi.Xiangqi

final private class CaptchaApi(gameRepo: GameRepo)(using Executor) extends ICaptchaApi:

  def any: Captcha = Impl.challenges.head

  def get(id: GameId): Fu[Captcha] = Impl.find(id) match
    case None => Impl.getFromDb(id).dmap(_ | Impl.default).addEffect(Impl.add)
    case Some(c) => fuccess(c)

  def validate(gameId: GameId, move: String): Fu[Boolean] =
    get(gameId).map(_.solutions.contains(move))

  def validateSync(data: WithCaptcha): Boolean =
    validate(data.gameId, data.move).await(2.seconds, "CaptchaApi.validateSync")

  def newCaptcha() = Impl.refresh

  private object Impl:

    val default = Captcha(
      gameId = GameId("00000000"),
      fen = BoardFen("4k4/9/9/9/9/9/3R5/R8/9/5K3"),
      color = chess.White,
      solutions = NonEmptyList.one("a3 e3"),
      moves = Map("a3" -> Vector("e3"))
    )

    def refresh = createFromDb.andThen:
      case Success(Some(captcha)) => add(captcha)

    var challenges = NonEmptyList.one(default)
    private val capacity = 256

    def add(c: Captcha): Unit =
      if find(c.gameId).isEmpty then challenges = NonEmptyList(c, challenges.toList.take(capacity))

    def find(id: GameId): Option[Captcha] =
      challenges.find(_.gameId == id)

    def createFromDb: Fu[Option[Captcha]] =
      findCheckmateInDb(10).orElse(findCheckmateInDb(1)).flatMapz(fromGame)

    def findCheckmateInDb(distribution: Int): Fu[Option[Game]] =
      gameRepo.findRandomCheckmate(distribution)

    def getFromDb(id: GameId): Fu[Option[Captcha]] =
      gameRepo.game(id).flatMapz(fromGame)

    def fromGame(game: Game): Fu[Option[Captcha]] =
      fuccess(makeCaptcha(game))

    def makeCaptcha(game: Game): Option[Captcha] =
      for
        lastMove <- game.xiangqi.moves.lastOption
        before <- game.xiangqi.states.dropRight(1).lastOption
        if game.status == chess.Status.Mate
        if game.xiangqi.state.check && game.xiangqi.state.immediateEnd.ended
        legalMoves = before.legalMoves.groupMap(_.orig)(_.dest)
        solutions: Solutions = NonEmptyList.one(s"${lastMove.orig} ${lastMove.dest}")
        color = if before.turn == Xiangqi.Side.Red then chess.White else chess.Black
      yield Captcha(
        gameId = game.id,
        fen = BoardFen(before.fen.takeWhile(_ != ' ')),
        color = color,
        solutions = solutions,
        moves = legalMoves
      )
