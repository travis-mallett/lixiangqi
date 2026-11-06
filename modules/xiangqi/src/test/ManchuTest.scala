package lila.xiangqi

import munit.FunSuite
import Xiangqi.*
import adjudication.Ruleset

class ManchuTest extends FunSuite:
  private def initial(fen: String = ManchuRules.startFen): Game =
    GameVariant.Manchu.initialGame(Some(fen), Ruleset.Manchu).fold(fail(_), identity)

  private def play(game: Game, move: String): Game =
    XiangqiRules.move(game, Uci.unsafe(move)).flatMap(game.applyMove).fold(fail(_), identity)

  test("PyChess Manchu+R army and persistent native identity"):
    val game = initial()
    val board = Fen.board(game.state.fen).get
    assertEquals(board.pieces.values.count(_.side.red), 16)
    assertEquals(board.pieces.values.count(_.side.black), 12)
    assertEquals(board.pieceAt("a10"), Some(Piece(Side.Black, Role.Banner)))
    assertEquals(board.pieceAt("i10"), Some(Piece(Side.Black, Role.Chariot)))
    assert(!board.pieces.values.exists(p => p.side.black && Set(Role.Horse, Role.Cannon)(p.role)))
    assertEquals(initial(ManchuRules.startFen.replace(" w m ", " w - ")).state, game.state)
    assert(GameVariant.Xiangqi.initialGame(Some(game.state.fen), Ruleset.default).isLeft)
    assert(GameVariant.Manchu.initialGame(Some(Xiangqi.startFen), Ruleset.Manchu).isLeft)
    assert(!Fen.isValid(Jieqi.startFen.replace("x", "m")))
    val captured = play(initial("4k4/9/9/9/4p4/9/9/9/m8/R3K4 w m - 0 1"), "a1a2")
    assertEquals(captured.variant, GameVariant.Manchu)
    assertEquals(captured.ruleset, Ruleset.Manchu)
    assertEquals(initial(captured.state.fen).variant, GameVariant.Manchu)

  test("native legal moves match the distributed Fairy-Stockfish Manchu engine through three plies"):
    def perft(board: Board, side: Side, depth: Int): Long =
      val moves = XiangqiRules.boardMoves(board, side)
      if depth == 1 then moves.size.toLong
      else
        moves
          .map: move =>
            perft(XiangqiRules.movedBoard(board, move), !side, depth - 1)
          .sum
    val board = Fen.board(ManchuRules.startFen).get
    assertEquals(perft(board, Side.Red, 1), 48L)
    assertEquals(perft(board, Side.Red, 3), 45712L)

  test("Banner slides, captures with one screen, and uses blocked horse legs"):
    val game = initial("4k4/9/9/9/4p4/9/9/9/9/M3K4 w m - 0 1")
    val moves = game.state.legalMoves.map(_.value).filter(_.startsWith("a1"))
    assert(moves.contains("a1a10"))
    assert(moves.contains("a1d1"))
    assert(moves.contains("a1b3"))
    assert(moves.contains("a1c2"))
    assert(!moves.contains("a1b2"))
    val screened = initial("4k4/9/9/9/4p4/9/p8/9/P8/M3K4 w m - 0 1")
    val screenedMoves = screened.state.legalMoves.map(_.value)
    assert(screenedMoves.contains("a1a4"))
    assert(!screenedMoves.contains("a1a3"))
    assert(!screenedMoves.contains("a1a2"))
    assert(!screenedMoves.contains("a1b3"))
    assert(screenedMoves.contains("a1c2"))
    assert(
      !initial(screened.state.fen.replace("p8/9/P8", "p8/P8/P8")).state.legalMoves
        .map(_.value)
        .contains("a1a4")
    )

  test("Banner attacks participate in check and pinned-piece legality"):
    val checked = initial("4k4/9/9/9/4p4/9/9/4m4/9/4K4 w m - 0 1")
    assert(checked.state.check)
    val pinned = initial("4k4/9/9/9/4m4/9/9/9/9/4K4 b m - 0 1")
    assert(!pinned.state.legalMoves.map(_.value).contains("e6d6"))

  test("shared repetition and no-capture rules retain Manchu semantics"):
    val loop = Vector("a1a2", "i10i9", "a2a1", "i9i10")
    val draw = (loop ++ loop).foldLeft(initial("4k3r/9/9/9/4p4/9/9/9/9/M3K4 w m - 0 1"))(play)
    assertEquals(draw.state.termination, Some("repetition"))
    val checks = Vector("e10f10", "e9f9", "f10e10", "f9e9")
    val loss = (checks ++ checks).foldLeft(initial("4k4/4M4/9/9/9/9/9/9/9/3K5 b m - 0 1"))(play)
    assertEquals(loss.state.gameResult, Result.BlackWin)
    assertEquals(loss.state.termination, Some("perpetual-check"))
    assertEquals(
      play(initial(ManchuRules.startFen.replace("0 1", "99 1")), "a4a5").state.termination,
      Some("no-progress")
    )
    val capture = play(initial("4k4/9/9/9/4p4/9/9/9/m8/R3K4 w m - 99 1"), "a1a2")
    assertEquals(capture.state.fen.split(' ')(4), "0")
    assert(!capture.state.ended)

  test("Banner notation distinguishes horse targets from sliding distances and round-trips branches"):
    val game = initial("4k4/9/9/9/4p4/9/9/9/9/M3K4 w m - 0 1")
    assertEquals(XiangqiRules.wxf(game.state.fen, Uci.unsafe("a1c2")), Right("M9+7"))
    assertEquals(XiangqiRules.wxf(game.state.fen, Uci.unsafe("a1a3")), Right("M9+2"))
    val imported = XiangqiNotation
      .importTree(NotationImport(notation = """[Variant "Manchu+"]
                                              |1. a4a5 a10b8 (1... a10b10) *""".stripMargin))
      .fold(fail(_), identity)
    assertEquals(imported.initialFen, ManchuRules.startFen)
    val restored = XiangqiNotation
      .importTree(NotationImport(notation = XiangqiNotation.exportTree(imported)))
      .fold(fail(_), identity)
    assertEquals(restored.children, imported.children)
