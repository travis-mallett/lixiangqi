package lila.study

import chess.format.Fen

import lila.xiangqi.Xiangqi

class StudyIntegrationTest extends munit.FunSuite:

  test("study moves use native Xiangqi rules and WXF notation"):
    val move = AnaMove(
      orig = chess.Square.fromKey("a4").get,
      dest = chess.Square.fromKey("a5").get,
      path = chess.format.UciPath.root,
      chapterId = StudyChapterId("chapter").some
    )

    val branch = move.branch(Fen.Full(Xiangqi.startFen)).toOption.get

    assertEquals(branch.move.san.value, "P9+1")
    assertEquals(
      branch.fen.value,
      "rnbakabnr/9/1c5c1/p1p1p1p1p/9/P8/2P1P1P1P/1C5C1/9/RNBAKABNR b - - 1 1"
    )
    assertEquals(branch.ply.value, 1)

  test("study rejects foreign chess FENs"):
    val move = AnaMove(
      orig = chess.Square.fromKey("e2").get,
      dest = chess.Square.fromKey("e4").get,
      path = chess.format.UciPath.root,
      chapterId = none
    )
    val chessFen = Fen.Full("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")

    assert(move.branch(chessFen).isLeft)
