package lila.xiangqi

import munit.FunSuite

class XiangqiTest extends FunSuite:
  import Xiangqi.*

  test("standard start FEN and rank ten UCI contract"):
    assertEquals(startFen.split('/').size, 10)
    assertEquals(Uci.from("a10a9").map(_.value), Right("a10a9"))
    assert(Uci.from("j1j2").isLeft)
    assert(Uci.from("a0a1").isLeft)

  test("native side and result values reject chess terminology"):
    assertEquals(Side.fromKey("red"), Right(Side.Red))
    assertEquals(!Side.Red, Side.Black)
    assertEquals(Result.fromKey("1-0"), Right(Result.RedWin))
    assert(Side.fromKey("white").isLeft)

  test("Xiangqi FEN validation enforces 9 by 10 geometry"):
    assert(Fen.isValid(startFen))
    assert(Fen.isValid("4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1"))
    assert(!Fen.isValid("8/8/8/8/8/8/8/8 w - - 0 1"))
    assert(!Fen.isValid(startFen.replace("9/", "45/")))
    assert(!Fen.isValid(startFen.replace(" w ", " white ")))

  test("board parsing uses native roles, coordinates, and Xiangqi material"):
    val board = Fen.board(startFen).get
    assertEquals(board.pieceAt("e1"), Some(Piece(Side.Red, Role.General)))
    assertEquals(board.pieceAt("b1"), Some(Piece(Side.Red, Role.Horse)))
    assertEquals(board.pieceAt("h8"), Some(Piece(Side.Black, Role.Cannon)))
    assertEquals(board.materialImbalance(Side.Red), 0)

    val withoutBlackChariot = Fen.board(startFen.replace("rnbakabnr", "1nbakabnr")).get
    assertEquals(withoutBlackChariot.materialImbalance(Side.Red), Role.Chariot.material)

  test("game transition keeps coordinate moves authoritative"):
    val start = State(
      variant = "xiangqi",
      fen = startFen,
      ply = 0,
      turn = Side.Red,
      legalMoves = Vector(Uci.unsafe("a4a5")),
      check = false,
      insufficientMaterial = false,
      gameResult = Result.Ongoing,
      immediateEnd = Ending(false, 0),
      optionalEnd = Ending(false, 0)
    )
    val move = MoveResult(
      move = Uci.unsafe("a4a5"),
      notation = "P9+1",
      chineseNotation = "兵九进一",
      capture = false,
      checkmate = false,
      variant = "xiangqi",
      fen = startFen.replace(" w ", " b "),
      ply = 1,
      turn = Side.Black,
      legalMoves = Vector.empty,
      check = false,
      insufficientMaterial = false,
      gameResult = Result.Ongoing,
      immediateEnd = Ending(false, 0),
      optionalEnd = Ending(false, 0)
    )
    val game = Game.fromState(startFen, start).toOption.get
    val next = game.applyMove(move).toOption.get
    assertEquals(next.moves.map(_.value), Vector("a4a5"))
    assertEquals(next.wxf, Vector("P9+1"))
    assertEquals(next.notations(NotationStyle.English), Vector("P9+1"))
    assertEquals(next.notations(NotationStyle.Chinese), Vector("兵九进一"))
    assertEquals(next.state.turn, Side.Black)

  test("native rules generate the standard position without an engine"):
    val state = XiangqiRules.position(Position()).toOption.get
    assertEquals(state.fen, startFen)
    assertEquals(state.turn, Side.Red)
    assertEquals(state.legalMoves.size, 44)
    assert(state.legalMoves.contains(Uci.unsafe("a4a5")))
    assert(!state.legalMoves.contains(Uci.unsafe("a4b4")))

  test("native starting-position perft matches the Pikafish reference"):
    def perft(fen: String, depth: Int): Long =
      if depth == 0 then 1
      else
        XiangqiRules
          .legalMoves(fen)
          .toOption
          .get
          .map: move =>
            val next = XiangqiRules.move(Position(initialFen = fen), move).toOption.get
            perft(next.fen, depth - 1)
          .sum

    assertEquals(perft(startFen, 1), 44L)
    assertEquals(perft(startFen, 2), 1920L)

  test("native move transition produces Pikafish-compatible FEN and WXF"):
    val move = XiangqiRules.move(Position(), Uci.unsafe("a4a5")).toOption.get
    assertEquals(move.notation, "P9+1")
    assertEquals(move.chineseNotation, "兵九进一")
    assertEquals(move.turn, Side.Black)
    assertEquals(
      move.fen,
      "rnbakabnr/9/1c5c1/p1p1p1p1p/9/P8/2P1P1P1P/1C5C1/9/RNBAKABNR b - - 1 1"
    )
    assert(!move.capture)
    assert(!move.checkmate)

  test("native notation renders WXF Chinese moves for both sides"):
    assertEquals(
      XiangqiRules.chinese(startFen, Uci.unsafe("b3e3")),
      Right("炮八平五")
    )
    val afterRed = XiangqiRules.move(Position(), Uci.unsafe("b3e3")).toOption.get.fen
    assertEquals(
      XiangqiRules.chinese(afterRed, Uci.unsafe("b10c8")),
      Right("马2进3")
    )
    assertEquals(
      XiangqiRules.chinese(afterRed, Uci.unsafe("b8e8")),
      Right("砲2平5")
    )

  test("WXF notation uses uppercase pieces for Red and lowercase pieces for Black"):
    assertEquals(
      XiangqiRules.wxf(startFen, Uci.unsafe("b3e3")),
      Right("C8=5")
    )
    val afterRed = XiangqiRules.move(Position(), Uci.unsafe("b3e3")).toOption.get.fen
    assertEquals(
      XiangqiRules.wxf(afterRed, Uci.unsafe("b10c8")),
      Right("h2+3")
    )

  test("WXF notation prefixes front and rear markers before doubled piece letters"):
    val red = "4k4/9/9/9/R3P4/9/R8/9/9/4K4 w - - 0 1"
    assertEquals(
      XiangqiRules.wxf(red, Uci.unsafe("a6b6")),
      Right("+R=8")
    )
    assertEquals(
      XiangqiRules.wxf(red, Uci.unsafe("a4a5")),
      Right("-R+1")
    )

    val black = "1n2k4/9/1n7/9/4p4/9/9/9/9/4K4 b - - 0 1"
    assertEquals(
      XiangqiRules.wxf(black, Uci.unsafe("b8c6")),
      Right("+h+3")
    )
    assertEquals(
      XiangqiRules.wxf(black, Uci.unsafe("b10c8")),
      Right("-h+3")
    )

  test("WXF notation identifies three same-file Pawns by front order and origin file"):
    val red = "4k4/9/3P5/3P5/3PP4/9/9/9/9/4K4 w - - 0 1"
    assertEquals(
      XiangqiRules.wxf(red, Uci.unsafe("d8e8")),
      Right("16=5")
    )
    assertEquals(
      XiangqiRules.wxf(red, Uci.unsafe("d7e7")),
      Right("26=5")
    )
    assertEquals(
      XiangqiRules.wxf(red, Uci.unsafe("d6e6")),
      Right("36=5")
    )
    assertEquals(
      XiangqiRules.chinese(red, Uci.unsafe("d8e8")),
      Right("前兵平五")
    )
    assertEquals(
      XiangqiRules.chinese(red, Uci.unsafe("d7e7")),
      Right("中兵平五")
    )
    assertEquals(
      XiangqiRules.chinese(red, Uci.unsafe("d6e6")),
      Right("后兵平五")
    )

    val black = "4k4/9/9/9/4p4/3p5/3p5/3p5/9/4K4 b - - 0 1"
    assertEquals(
      XiangqiRules.wxf(black, Uci.unsafe("d3e3")),
      Right("14=5")
    )
    assertEquals(
      XiangqiRules.wxf(black, Uci.unsafe("d5e5")),
      Right("34=5")
    )

  test("Chinese notation disambiguates doubled pieces from front to rear"):
    val fen = "4k4/9/9/9/9/R8/9/R8/9/4K4 w - - 0 1"
    assertEquals(
      XiangqiRules.chinese(fen, Uci.unsafe("a5b5")),
      Right("前车平八")
    )
    assertEquals(
      XiangqiRules.chinese(fen, Uci.unsafe("a3b3")),
      Right("后车平八")
    )

  test("live moves transition from the current immutable state without replaying history"):
    val cycle = Vector("b1c3", "b10c8", "c3b1", "c8b10").map(Uci.unsafe)
    val game = XiangqiRules.game(Position(moves = Vector.fill(20)(cycle).flatten)).toOption.get
    val next = cycle.head
    assertEquals(
      XiangqiRules.move(game, next),
      XiangqiRules.move(game.position, next)
    )

  test("native rules reject flying-general exposure"):
    val position = Position(
      initialFen = "4k4/9/9/9/9/4N4/9/9/9/4K4 w - - 0 1"
    )
    val state = XiangqiRules.position(position).toOption.get
    assert(!state.legalMoves.contains(Uci.unsafe("e5d7")))
    assert(XiangqiRules.move(position, Uci.unsafe("e5d7")).isLeft)

  test("native rules report checkmate and winner"):
    val move = XiangqiRules
      .move(
        Position(initialFen = "4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1"),
        Uci.unsafe("a3e3")
      )
      .toOption
      .get
    assert(move.check)
    assert(move.checkmate)
    assertEquals(move.gameResult, Result.RedWin)

  test("captures reset the canonical Xiangqi FEN halfmove counter"):
    val move = XiangqiRules
      .move(
        Position(initialFen = "4k4/9/9/9/9/4P4/9/9/p8/R3K4 w - - 17 9"),
        Uci.unsafe("a1a2")
      )
      .toOption
      .get
    assertEquals(move.fen.split(' ')(4), "0")

  test("lesson validation keeps the learner turn between targets"):
    val result = XiangqiRules.Lesson
      .validate(
        Position(
          initialFen = "4k4/9/9/9/9/4p4/9/9/4A4/3K5 w - - 0 1",
          moves = Vector("e2f3", "f3e2", "e2d3").map(Uci.unsafe)
        )
      )
      .toOption
      .get
    assertEquals(result.positions.size, 4)
    assertEquals(result.notations.size, 3)

  test("native notation import preserves recursive variations"):
    val tree = XiangqiRules.Notation
      .importTree(
        NotationImport(
          notation = """[Variant "Xiangqi"]

1. P9+1 p1+1 (1... h2+3 2. P7+1) 2. P7+1"""
        )
      )
      .toOption
      .get
    val first = tree.children.head
    assertEquals(first.move.value, "a4a5")
    assertEquals(first.children.map(_.move.value), Vector("a7a6", "b10c8"))
    assertEquals(first.children.map(_.state.ply), Vector(2, 2))
    assertEquals(first.children.map(_.children.head.move.value), Vector("c4c5", "c4c5"))

  test("native notation import accepts WXF Chinese"):
    val tree = XiangqiRules.Notation
      .importTree(NotationImport(notation = "1. 兵九进一 卒1进1"))
      .toOption
      .get
    assertEquals(tree.children.head.move.value, "a4a5")
    assertEquals(tree.children.head.chineseNotation, "兵九进一")
    assertEquals(tree.children.head.children.head.move.value, "a7a6")
    assertEquals(tree.children.head.children.head.chineseNotation, "卒1进1")

  test("native notation import resolves official WXF front/rear subjects"):
    val fen = "4k4/9/9/9/R3P4/9/R8/9/9/4K4 w - - 0 1"
    val imported = XiangqiRules.Notation.importTree(
      NotationImport(initialFen = fen, notation = "+R=8")
    )
    assertEquals(imported.map(_.children.head.move.value), Right("a6b6"))
    assert(
      XiangqiRules.Notation
        .importTree(
          NotationImport(initialFen = fen, notation = "R+=8")
        )
        .isLeft
    )
