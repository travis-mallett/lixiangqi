package lila.xiangqi

import munit.FunSuite
import Xiangqi.*
import adjudication.Ruleset

class MiniXiangqiTest extends FunSuite:
  private def initial(fen: String = MiniXiangqiRules.startFen): Game =
    GameVariant.MiniXiangqi.initialGame(Some(fen), Ruleset.MiniXiangqi).fold(fail(_), identity)

  private def play(game: Game, move: String): Game =
    XiangqiRules.move(game, Uci.unsafe(move)).flatMap(game.applyMove).fold(fail(_), identity)

  test("Mini Xiangqi identity, geometry, start position and strict variant boundary"):
    val game = initial()
    assertEquals(game.variant, GameVariant.MiniXiangqi)
    assertEquals(game.state.fen, MiniXiangqiRules.startFen)
    assertEquals(game.ruleset, Ruleset.MiniXiangqi)
    assertEquals(Fen.board(game.state.fen).get.pieces.size, 24)
    assert(GameVariant.Xiangqi.initialGame(Some(game.state.fen), Ruleset.default).isLeft)
    assert(GameVariant.MiniXiangqi.initialGame(Some(Xiangqi.startFen), Ruleset.MiniXiangqi).isLeft)
    assert(!Fen.isValid(game.state.fen.replace("RCNKNCR", "RCNKNC8")))
    assert(!Fen.isValid(game.state.fen.replace("RCNKNCR", "RCAKACR")))
    assert(
      !game.state.legalMoves.exists(m => m.value.exists(c => c == 'h' || c == 'i' || c == '8' || c == '9'))
    )

  test("native move generation matches Fairy-Stockfish Mini Xiangqi perft through three plies"):
    def perft(fen: String, depth: Int): Long =
      if depth == 0 then 1L
      else
        XiangqiRules
          .legalMoves(fen)
          .fold(fail(_), identity)
          .map: move =>
            perft(XiangqiRules.boardMove(fen, move).fold(fail(_), identity).fen, depth - 1)
          .sum
    assertEquals(perft(MiniXiangqiRules.startFen, 1), 19L)
    assertEquals(perft(MiniXiangqiRules.startFen, 2), 331L)
    assertEquals(perft(MiniXiangqiRules.startFen, 3), 6664L)

  test("soldiers move sideways immediately, horses retain blocked legs, cannons require a screen"):
    val moves = initial().state.legalMoves.map(_.value)
    assert(moves.contains("a2b2"))
    assert(moves.contains("a2a3"))
    assert(!moves.contains("a2a1"))
    assert(!moves.contains("c1b3"))
    assert(moves.contains("b1b6"))
    assert(!moves.contains("b1b7"))
    val custom = initial("3k3/7/7/1p1p3/7/7/1C1K3 w - - 0 1")
    assert(!custom.state.legalMoves.map(_.value).contains("b1b4"))

  test("palaces are c-e on ranks 1-3 and 5-7, and generals cannot face"):
    val red = initial("3k3/7/7/3P3/2K4/7/7 w - - 0 1")
    assertEquals(red.state.legalMoves.map(_.value).filter(_.startsWith("c3")).sorted, Vector("c3c2", "c3d3"))
    val black = initial("7/7/4k2/3p3/7/7/3K3 b - - 0 1")
    assertEquals(
      black.state.legalMoves.map(_.value).filter(_.startsWith("e5")).sorted,
      Vector("e5d5", "e5e6")
    )
    val facing = initial("3k3/7/7/3R3/7/7/3K3 w - - 0 1")
    assert(!facing.state.legalMoves.map(_.value).contains("d4c4"))

  test("three repetitions draw; unilateral perpetual check loses"):
    val loop = Vector("a1a2", "g7g6", "a2a1", "g6g7")
    val draw = (loop ++ loop).foldLeft(initial("3k2r/7/7/3p3/7/7/R2K3 w - - 0 1"))(play)
    assertEquals(draw.state.gameResult, Result.Draw)
    assertEquals(draw.state.termination, Some("repetition"))
    val checks = Vector("d7e7", "d6e6", "e7d7", "e6d6")
    val loss = (checks ++ checks).foldLeft(initial("3k3/3R3/7/7/7/7/2K4 b - - 0 1"))(play)
    assertEquals(loss.state.gameResult, Result.BlackWin)
    assertEquals(loss.state.termination, Some("perpetual-check"))

  test("fifty moves per side without capture draw, including soldier moves"):
    val game = initial(MiniXiangqiRules.startFen.replace("0 1", "99 1"))
    assertEquals(play(game, "a2a3").state.termination, Some("no-progress"))
    assertEquals(initial(MiniXiangqiRules.startFen.replace("0 1", "100 1")).state.gameResult, Result.Draw)

  test("native notation and branch history retain the Mini Xiangqi variant"):
    val imported = XiangqiNotation
      .importTree(NotationImport(notation = """[Variant "Mini Xiangqi"]
                                              |1. a2b2 (1. a2a3) a6b6 *""".stripMargin))
      .fold(fail(_), identity)
    assertEquals(imported.initialFen, MiniXiangqiRules.startFen)
    assertEquals(imported.state.variant, "minixiangqi")
    val restored = XiangqiNotation
      .importTree(NotationImport(notation = XiangqiNotation.exportTree(imported)))
      .fold(fail(_), identity)
    assertEquals(restored.children, imported.children)

  test("stalemate loses and a capture resets the no-progress counter"):
    val stuck = initial("3k3/7/7/7/7/1r5/2K4 w - - 0 1")
    assertEquals(stuck.state.termination, Some("stalemate"))
    assertEquals(stuck.state.gameResult, Result.BlackWin)
    val capture = play(initial("3k3/7/7/p2p3/7/7/R2K3 w - - 99 1"), "a1a4")
    assertEquals(capture.state.fen.split(' ')(4), "0")
    assert(!capture.state.ended)
