package lila.game

import chess.{ ByColor, Color, Rated, Status }
import lila.core.game.{ Player, Source, newGame }
import lila.core.id.GamePlayerId
import lila.xiangqi.{ Xiangqi, XiangqiRules }

class CaptchaTest extends munit.FunSuite:

  private val blackFen = "2bak2nr/4a4/2c1b2c1/p3pCp1p/9/2p4R1/P3P1P1P/3A4C/1rN1K1n2/R2A2BN1 b - - 0 1"

  for (fen, move, color) <- List(
      (blackFen, "b2c2", Color.Black),
      ("4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1", "a3e3", Color.White)
    )
  do
    test(s"${color.name} CAPTCHA retains the turn and legal mating move"):
      val xiangqi = XiangqiRules
        .game(
          Xiangqi.Position(initialFen = fen, moves = Vector(Xiangqi.Uci.unsafe(move)))
        )
        .fold(fail(_), identity)
      val game = newGame(
        xiangqi = xiangqi,
        players = ByColor(
          Player(GamePlayerId("red1"), Color.White, None),
          Player(GamePlayerId("blk1"), Color.Black, None)
        ),
        rated = Rated.No,
        source = Source.Lobby,
        pgnImport = None
      ).sloppy.copy(status = Status.Mate)
      val captcha = CaptchaApi.makeCaptcha(game).getOrElse(fail("Expected a mate CAPTCHA"))
      assertEquals(captcha.fen.value, xiangqi.states.head.fen)
      assertEquals(captcha.fen.value.split(" ")(1), if color.white then "w" else "b")
      assertEquals(captcha.color, color)
      assert(captcha.moves(move.take(2)).contains(move.drop(2)))
      assert(captcha.solutions.contains(s"${move.take(2)} ${move.drop(2)}"))
