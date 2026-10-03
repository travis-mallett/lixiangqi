package lila.xiangqi

import Xiangqi.*

class XiangqiMotifsTest extends munit.FunSuite:
  private def motifs(fen: String) = XiangqiMotifs(Position(initialFen = fen)).toOption.get

  test("native rook pins point to the general"):
    val found = motifs("3k5/4r4/9/9/9/4R4/9/9/9/4K4 w - - 0 1")
    assert(found.pins.contains(XiangqiMotifs.Pin("e5", "e9", "e1")))

  test("a cannon pins either of two screens to the general"):
    val found = motifs("3k5/4c4/9/9/9/4R4/4P4/9/9/4K4 w - - 0 1")
    assert(found.pins.contains(XiangqiMotifs.Pin("e5", "e9", "e1")))
    assert(found.pins.contains(XiangqiMotifs.Pin("e4", "e9", "e1")))

  test("exchange evaluation uses file i and rank ten"):
    val found = motifs("3k4r/9/9/9/9/9/9/9/9/4K3R w - - 0 1")
    assert(
      found.undefended.exists(m => m.square == "i10" && m.principalAttacker == "i1" && m.materialLoss == 9)
    )

  test("checking hints are native legal moves and disappear in terminal states"):
    val position = Position(initialFen = "4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1")
    val found = XiangqiMotifs(position).toOption.get
    val state = XiangqiRules.position(position).toOption.get
    assert(found.checkable.exists(m => m.general == "e10" && state.legalMoves.contains(m.move)))
    val ended = position.copy(moves = Vector(Uci.unsafe("a3e3")))
    assertEquals(XiangqiMotifs(ended).toOption.get.checkable, Vector.empty)
