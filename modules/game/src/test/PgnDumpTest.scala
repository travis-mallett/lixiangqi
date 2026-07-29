package lila.game

import chess.*
import chess.format.pgn.PgnTree.*
import chess.format.pgn.{ Move, SanStr }

class PgnDumpTest extends munit.FunSuite:

  private def assertMoveText(moveText: String) =
    val moves = moveText.split(' ').toList.map(SanStr(_))
    val output = PgnDump.makeTree(moves, Vector.empty, Color.White).so(_.render(Ply.firstMove))
    val withoutMoveNumbers = output.split(' ').grouped(3).flatMap(_.drop(1)).mkString(" ")
    assertEquals(withoutMoveNumbers, moveText)

  private def assertNumberedMoveText(moveText: String) =
    val moves = moveText.split(' ').toList.grouped(3).flatMap(_.drop(1)).map(SanStr(_)).toList
    val output = PgnDump.makeTree(moves, Vector.empty, Color.White).so(_.render(Ply.firstMove))
    assertEquals(output, moveText)

  test("roundtrip WXF move text"):
    rawMoveText.foreach(assertMoveText)

  test("roundtrip numbered WXF move text"):
    numberedMoveText.foreach(assertNumberedMoveText)

  test("build a WXF move tree"):
    assertEquals(
      PgnDump
        .makeTree("C2=5 H8+7 H2+3".split(' ').toList.map(SanStr(_)), Vector.empty, Color.White)
        .get,
      Node(
        Move(SanStr("C2=5")),
        Some(
          Node(
            Move(SanStr("H8+7")),
            Some(Node(Move(SanStr("H2+3")), None))
          )
        )
      )
    )

  private val rawMoveText = List(
    "C2=5 H8+7 H2+3 R9=8 R1=2 C8=5 P7+1 P3+1 H2+3 H7+8",
    "P3+1 P7+1 H2+3 H8+7 R1=2 R9=8 C2=5 C8=5",
    "H2+3 H8+7 C2=5 C8=5 R1=2 R9=8 P7+1 P3+1"
  )

  private val numberedMoveText = List(
    "1. C2=5 H8+7 2. H2+3 R9=8 3. R1=2 C8=5 4. P7+1 P3+1 5. H2+3 H7+8",
    "1. P3+1 P7+1 2. H2+3 H8+7 3. R1=2 R9=8 4. C2=5 C8=5"
  )
