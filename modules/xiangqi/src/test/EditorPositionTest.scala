package lila.xiangqi

import munit.FunSuite

class EditorPositionTest extends FunSuite:
  import Xiangqi.*

  test("standard editor accepts either turn and a checked side to move"):
    assertEquals(XiangqiRules.validateStandardPosition(startFen), Right(()))
    assertEquals(XiangqiRules.validateStandardPosition(startFen.replace(" w ", " b ")), Right(()))
    assertEquals(
      XiangqiRules.validateStandardPosition("4k4/9/4R4/9/9/9/9/9/9/3K5 b - - 0 1"),
      Right(())
    )

  test("strict editor rejects impossible placements without changing diagram replay"):
    val invalid = List(
      "9/9/9/9/9/9/9/9/9/9 w - - 0 1", // Missing generals
      "3kk4/9/9/9/9/9/9/9/9/3K5 w - - 0 1", // Duplicate general
      "4k4/9/9/9/5p3/9/9/9/9/3K5 w - - 0 1", // Soldier off its original file before crossing
      "4k4/9/9/9/9/9/9/9/9/K8 w - - 0 1", // General outside palace
      "4k4/9/9/9/9/9/9/9/3A5/3K5 w - - 0 1", // Unreachable advisor
      "4k4/9/9/9/2B6/9/9/9/9/3K5 w - - 0 1", // Elephant across the river
      "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1", // Facing generals
      "4k4/9/4R4/9/9/9/9/9/9/3K5 w - - 0 1", // Wrong side to move in check
      "4k4/9/9/9/9/9/9/9/RRR6/3K5 w - - 0 1" // Too many chariots
    )
    invalid.foreach: fen =>
      assert(XiangqiRules.validateStandardPosition(fen).isLeft, fen)
      assert(XiangqiRules.position(Position(initialFen = fen)).isRight, fen)

  test("editor rejects variants even when their armies fit a standard board"):
    List(Jieqi.startFen, MiniXiangqiRules.startFen, ManchuRules.startFen, startFen.replace(" - - ", " m - "))
      .foreach(fen => assert(XiangqiRules.validateStandardPosition(fen).isLeft, fen))

  test("legal terminal positions are valid diagrams but cannot start another game"):
    val fen = "4k4/3R1R3/9/9/9/9/9/9/9/3K5 b - - 0 1"
    assertEquals(XiangqiRules.validateStandardPosition(fen), Right(()))
    val state = XiangqiRules.position(Position(initialFen = fen)).toOption.get
    assertEquals(state.legalMoves, Vector.empty)
    assertEquals(state.gameResult, Result.RedWin)

  test("variant editors accept their starts and enforce their own armies"):
    for variant <- List(GameVariant.Xiangqi, GameVariant.Jieqi, GameVariant.MiniXiangqi, GameVariant.Manchu)
    do
      assertEquals(XiangqiRules.validateEditorPosition(variant.startFen, variant), Right(()), variant.key)
      assert(XiangqiRules.validateEditorPosition(variant.startFen, GameVariant.ThreeKingdoms).isLeft)
    assert(
      XiangqiRules
        .validateEditorPosition(ManchuRules.startFen.replace("m1bakab1r", "mnbakab1r"), GameVariant.Manchu)
        .isLeft
    )
    assert(
      XiangqiRules
        .validateEditorPosition(ManchuRules.startFen.replace("RNBAKABNR", "MNBAKABNR"), GameVariant.Manchu)
        .isLeft
    )
    assertEquals(
      XiangqiRules
        .validateEditorPosition(ManchuRules.startFen.replace("m1bakab1r", "2bakab1r"), GameVariant.Manchu),
      Right(())
    )
    assertEquals(
      XiangqiRules.validateEditorPosition(
        MiniXiangqiRules.startFen.replace("P1PPP1P", "1PPPP1P"),
        GameVariant.MiniXiangqi
      ),
      Right(())
    )
    assert(
      XiangqiRules
        .validateEditorPosition(
          MiniXiangqiRules.startFen.replace("RCNKNCR", "PCNKNCR"),
          GameVariant.MiniXiangqi
        )
        .isLeft
    )

  test(
    "Jieqi counts revealed roles separately from concealed slots and allows unrestricted revealed advisors"
  ):
    val revealed = Jieqi.startFen.replace("X1X1X1X1X", "A1X1X1X1X")
    assertEquals(XiangqiRules.validateEditorPosition(revealed, GameVariant.Jieqi), Right(()))
    assert(
      XiangqiRules
        .validateEditorPosition(revealed.replace("A1X1X1X1X", "A1A1A1X1X"), GameVariant.Jieqi)
        .isLeft
    )
    assert(
      XiangqiRules.validateEditorPosition(Jieqi.startFen.replace("1X5X1", "2X4X1"), GameVariant.Jieqi).isLeft
    )
