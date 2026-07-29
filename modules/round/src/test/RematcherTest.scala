package lila.round

import lila.xiangqi.Xiangqi

class RematcherTest extends munit.FunSuite:

  test("rematch resets a standard Xiangqi game to its canonical root"):
    val moved = Xiangqi.Game.initial.copy(
      moves = Vector(Xiangqi.Uci.unsafe("a4a5")),
      wxf = Vector("P9+1"),
      states = Vector(
        Xiangqi.Game.initial.state,
        Xiangqi.Game.initial.state.copy(
          ply = 1,
          turn = Xiangqi.Side.Black,
          fen = "rnbakabnr/9/1c5c1/2p1p1p1p/p8/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 1 1"
        )
      )
    )
    assertEquals(Rematcher.reset(moved), Xiangqi.Game.initial)

  test("rematch preserves a custom Xiangqi root"):
    val fen = "4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 7"
    val root = Xiangqi.Game.initial.state.copy(fen = fen, ply = 13, turn = Xiangqi.Side.Black)
    val custom = Xiangqi.Game.fromState(fen, root).fold(fail(_), identity)
    assertEquals(Rematcher.reset(custom), custom)
