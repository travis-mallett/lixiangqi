package lila.xiangqi

import Xiangqi.*
import munit.FunSuite

/** Small, deliberately isolated positions for the geometric edges of native Xiangqi move generation. */
class XiangqiMovementBoundaryTest extends FunSuite:

  private def position(pieces: (String, Char)*): String = positionWithTurn(Side.Red, pieces*)

  private def positionWithTurn(turn: Side, pieces: (String, Char)*): String =
    val board = pieces.toMap
    val ranks = (10 to 1 by -1).map: rank =>
      val cells = (0 to 8).map(file => board.getOrElse(s"${('a' + file).toChar}$rank", '1'))
      val row = StringBuilder()
      var empty = 0
      cells.foreach:
        case '1' => empty += 1
        case piece =>
          if empty > 0 then row.append(empty); empty = 0
          row.append(piece)
      if empty > 0 then row.append(empty)
      row.result()
    s"${ranks.mkString("/")} ${if turn == Side.Red then "w" else "b"} - - 0 1"

  private def moves(fen: String): Set[String] =
    XiangqiRules.legalMoves(fen).fold(fail(_), _.map(_.value).toSet)

  private def assertMoves(fen: String, legal: String*): Unit =
    val actual = moves(fen)
    legal.foreach(move => assert(actual.contains(move), s"Expected $move in $actual"))

  private def assertNotMoves(fen: String, illegal: String*): Unit =
    val actual = moves(fen)
    illegal.foreach(move => assert(!actual.contains(move), s"Did not expect $move in $actual"))

  test("horse uses each of its eight distinct legs, for both colors"):
    val jumps = Seq(
      ("e5d7", "e6"),
      ("e5f7", "e6"),
      ("e5c6", "d5"),
      ("e5c4", "d5"),
      ("e5d3", "e4"),
      ("e5f3", "e4"),
      ("e5g6", "f5"),
      ("e5g4", "f5")
    )
    for (move, leg) <- jumps do
      assertNotMoves(position("e5" -> 'N', leg -> 'P', "d1" -> 'K', "f10" -> 'k'), move)
    val blackJumps = Seq(
      ("e6d8", "e7"),
      ("e6f8", "e7"),
      ("e6c7", "d6"),
      ("e6c5", "d6"),
      ("e6d4", "e5"),
      ("e6f4", "e5"),
      ("e6g5", "f6"),
      ("e6g7", "f6")
    )
    for (blackMove, blackLeg) <- blackJumps do
      assertNotMoves(
        positionWithTurn(Side.Black, "e6" -> 'n', blackLeg -> 'p', "d1" -> 'K', "f10" -> 'k'),
        blackMove
      )
    assertMoves(position("e5" -> 'N', "d1" -> 'K', "f10" -> 'k'), jumps.map(_._1)*)
    assertMoves(positionWithTurn(Side.Black, "e6" -> 'n', "d1" -> 'K', "f10" -> 'k'), blackJumps.map(_._1)*)

  test("horse cannot land on a friendly piece"):
    assertNotMoves(position("e5" -> 'N', "d7" -> 'P', "d1" -> 'K', "f10" -> 'k'), "e5d7")

  test("elephant stays on its own bank and its eye must be clear"):
    assertNotMoves(position("d5" -> 'B', "d1" -> 'K', "f10" -> 'k'), "d5b7", "d5f7")
    assertMoves(position("d5" -> 'B', "d1" -> 'K', "f10" -> 'k'), "d5b3", "d5f3")
    assertNotMoves(positionWithTurn(Side.Black, "d6" -> 'b', "d1" -> 'K', "f10" -> 'k'), "d6b4", "d6f4")
    assertMoves(positionWithTurn(Side.Black, "d6" -> 'b', "d1" -> 'K', "f10" -> 'k'), "d6b8", "d6f8")
    assertNotMoves(position("e3" -> 'B', "d4" -> 'P', "d1" -> 'K', "f10" -> 'k'), "e3c5")
    assertMoves(position("e3" -> 'B', "d1" -> 'K', "f10" -> 'k'), "e3c5")

  test("cannon screens distinguish quiet moves from captures"):
    val clear = position("e5" -> 'C', "d1" -> 'K', "f10" -> 'k')
    assertMoves(clear, "e5e8", "e5e10")
    val unscreenedCapture = position("e5" -> 'C', "e8" -> 'r', "d1" -> 'K', "f10" -> 'k')
    assertNotMoves(unscreenedCapture, "e5e8")
    for screen <- Seq('P', 'p') do
      val one = position("e5" -> 'C', "e6" -> screen, "e8" -> 'r', "d1" -> 'K', "f10" -> 'k')
      assertMoves(one, "e5e8")
    val two = position("e5" -> 'C', "e6" -> 'P', "e7" -> 'p', "e8" -> 'r', "d1" -> 'K', "f10" -> 'k')
    assertNotMoves(two, "e5e8")
    assertNotMoves(position("e5" -> 'C', "e8" -> 'P', "d1" -> 'K', "f10" -> 'k'), "e5e8")

  test("soldiers change movement at the river and never move backward"):
    assertNotMoves(position("e4" -> 'P', "d1" -> 'K', "f10" -> 'k'), "e4d4", "e4f4")
    assertMoves(position("e6" -> 'P', "d1" -> 'K', "f10" -> 'k'), "e6d6", "e6f6", "e6e7")
    assertNotMoves(position("e6" -> 'P', "d1" -> 'K', "f10" -> 'k'), "e6e5")
    assertMoves(position("e10" -> 'P', "d8" -> 'k', "d3" -> 'K', "d5" -> 'P'), "e10d10", "e10f10")
    assertMoves(positionWithTurn(Side.Black, "e5" -> 'p', "d3" -> 'K', "f10" -> 'k'), "e5d5", "e5f5", "e5e4")
    assertNotMoves(positionWithTurn(Side.Black, "e5" -> 'p', "d3" -> 'K', "f10" -> 'k'), "e5e6")
    assertMoves(positionWithTurn(Side.Black, "e1" -> 'p', "d3" -> 'K', "f8" -> 'k'), "e1d1", "e1f1")

  test("generals and advisors remain inside their palaces"):
    assertMoves(position("e1" -> 'K', "f10" -> 'k', "f5" -> 'p'), "e1d1", "e1f1", "e1e2")
    assertNotMoves(position("e1" -> 'K', "f10" -> 'k', "f5" -> 'p'), "e1d2", "e1f2")
    assertMoves(position("e2" -> 'A', "d1" -> 'K', "f10" -> 'k'), "e2f1")
    assertNotMoves(position("e2" -> 'A', "d1" -> 'K', "f10" -> 'k'), "e2c3")
    assertMoves(positionWithTurn(Side.Black, "d8" -> 'a', "d1" -> 'K', "f10" -> 'k'), "d8e9")
    assertNotMoves(positionWithTurn(Side.Black, "d8" -> 'a', "d1" -> 'K', "f10" -> 'k'), "d8c9", "d8e7")

  test("a pinned rook may slide on the pin but cannot expose its general"):
    val fen = position("d3" -> 'R', "d10" -> 'r', "d1" -> 'K', "f10" -> 'k')
    assertNotMoves(fen, "d3c3", "d3e3")
    assertMoves(fen, "d3d4", "d3d2")
    val blackFen = positionWithTurn(Side.Black, "d8" -> 'r', "d1" -> 'R', "d10" -> 'k', "f1" -> 'K')
    assertNotMoves(blackFen, "d8c8", "d8e8")
    assertMoves(blackFen, "d8d7", "d8d9")

  test("terminal positions distinguish checkmate from stalemate"):
    val mate = "4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1"
    val stalemate = "4k4/9/3R1R3/9/9/4P4/9/9/R8/3K5 w - - 0 1"
    val mateState =
      XiangqiRules.position(Position(initialFen = mate, moves = Vector(Uci.unsafe("a3e3")))).toOption.get
    val stalemateState =
      XiangqiRules.position(Position(initialFen = stalemate, moves = Vector(Uci.unsafe("a2a9")))).toOption.get
    assertEquals(mateState.legalMoves, Vector.empty)
    assertEquals(mateState.termination, Some("checkmate"))
    assertEquals(stalemateState.legalMoves, Vector.empty)
    assertEquals(stalemateState.termination, Some("stalemate"))
