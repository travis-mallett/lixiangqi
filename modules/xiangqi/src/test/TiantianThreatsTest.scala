package lila.xiangqi

import lila.xiangqi.Xiangqi.*

/** Board-level regressions for the documented capture-threat definition, not claims about Tencent internals.
  */
class TiantianThreatsTest extends munit.FunSuite:
  private val discovered = "4k4/9/n8/9/P8/4P4/R8/9/9/3K5 w - - 0 1"
  private val pinned = "4k4/9/1n2r4/9/R8/9/4R4/9/9/3K5 w - - 0 1"
  private val screenedPin = "4k4/4p4/1n2r4/9/R8/9/4R4/9/9/3K5 w - - 0 1"
  private val vacatedScreen = "c3k4/9/1R7/9/n8/9/9/9/9/3K5 w - - 0 1"
  private val retainedScreen = "c3k4/P8/9/9/n8/1R7/9/9/9/3K5 w - - 0 1"
  private val exchange = "4k4/9/9/9/1r7/9/R8/9/9/3K5 w - - 0 1"
  private val horse = "4k4/9/9/3rr4/9/9/N8/9/9/5K3 w - - 0 1"
  private val cannon = "4k4/9/1rr6/9/1P7/9/C8/9/9/5K3 w - - 0 1"

  private def play(fen: String, move: String): MoveResult =
    val game = XiangqiRules.initialGame(Some(fen)).fold(fail(_), identity)
    assert(!game.state.check, "The fixture must begin without an unrelated check")
    XiangqiRules.move(game, Uci.unsafe(move)).fold(fail(_), identity)

  private def board(result: MoveResult): Board = Fen.board(result.fen).get

  private def capture(position: Board, move: String): Board =
    val uci = Uci.unsafe(move)
    val orig = Square.fromKey(uci.orig).get
    val dest = Square.fromKey(uci.dest).get
    val attacker = position.pieceAt(orig).get
    assert(XiangqiRules.captures(position, attacker.side).contains(uci), s"Expected legal capture: $move")
    position.copy(pieces = position.pieces - orig - dest + (dest -> attacker))

  test("moving a screen identifies the uncovered rook as the chaser"):
    val result = play(discovered, "a6b6")
    val fact = result.adjudication.get.fact.get
    assertEquals(fact.piece, "a6")
    assertEquals(fact.chasers, Vector("a4"))
    assertEquals(fact.targets, Vector("a8"))
    assert(!XiangqiRules.captures(Fen.board(discovered).get, Side.Red).contains(Uci.unsafe("a4a8")))
    assert(XiangqiRules.captures(board(result), Side.Red).contains(Uci.unsafe("a4a8")))

  test("a pinned rook cannot protect a horse, but an extra king screen restores protection"):
    for (fen, protectedTarget) <- Vector(pinned -> false, screenedPin -> true) do
      val result = play(fen, "a6b6")
      val captured = capture(board(result), "b6b8")
      assertEquals(
        XiangqiRules.captures(captured, Side.Black).contains(Uci.unsafe("e8b8")),
        protectedTarget
      )
      assertEquals(result.adjudication.get.fact.get.targets.contains("b8"), !protectedTarget)

  test("cannon protection is evaluated after the attacker vacates its original square"):
    val vacated = play(vacatedScreen, "b8a8")
    val afterVacating = capture(board(vacated), "a8a6")
    assertEquals(board(vacated).pieceAt("a8"), Some(Piece(Side.Red, Role.Chariot)))
    assert(afterVacating.pieceAt("a8").isEmpty)
    assert(!XiangqiRules.captures(afterVacating, Side.Black).contains(Uci.unsafe("a10a6")))
    assert(vacated.adjudication.get.fact.get.targets.contains("a6"))

    val retained = play(retainedScreen, "b5a5")
    val afterCapturing = capture(board(retained), "a5a6")
    assertEquals(afterCapturing.pieceAt("a9"), Some(Piece(Side.Red, Role.Soldier)))
    assert(XiangqiRules.captures(afterCapturing, Side.Black).contains(Uci.unsafe("a10a6")))
    assert(!retained.adjudication.get.fact.get.targets.contains("a6"))

  test("reciprocal legal rook captures are an exchange, not a chase"):
    val result = play(exchange, "a4b4")
    assert(XiangqiRules.captures(board(result), Side.Red).contains(Uci.unsafe("b4b6")))
    assert(XiangqiRules.captures(board(result), Side.Black).contains(Uci.unsafe("b6b4")))
    assertEquals(result.adjudication.get.fact.get.targets, Vector.empty)

  test("horses and cannons chase protected rooks despite a legal recapture"):
    for (fen, move, threat, recapture, target) <- Vector(
        (horse, "a4b6", "b6d7", "e7d7", "d7"),
        (cannon, "a4b4", "b4b8", "c8b8", "b8")
      )
    do
      val result = play(fen, move)
      val captured = capture(board(result), threat)
      assert(XiangqiRules.captures(captured, Side.Black).contains(Uci.unsafe(recapture)))
      assertEquals(result.adjudication.get.fact.get.targets, Vector(target))

  test("an uncrossed soldier target is exempt, but a crossed soldier target is a chase"):
    val uncrossed = "4k4/9/9/9/p8/9/1R7/9/9/3K5 w - - 0 1"
    val crossed = "4k4/9/9/9/9/p8/1R7/9/9/3K5 w - - 0 1"
    assertEquals(play(uncrossed, "b4a4").adjudication.get.fact.get.targets, Vector.empty)
    assertEquals(play(crossed, "b4a4").adjudication.get.fact.get.targets, Vector("a5"))

  test("targeted recapture checks agree with complete legal capture generation"):
    val transitions = Vector(
      discovered -> "a6b6",
      pinned -> "a6b6",
      screenedPin -> "a6b6",
      vacatedScreen -> "b8a8",
      retainedScreen -> "b5a5",
      exchange -> "a4b4",
      horse -> "a4b6",
      cannon -> "a4b4"
    )
    val positions = transitions.flatMap: (fen, move) =>
      val after = board(play(fen, move))
      val hypotheticalCaptures = XiangqiRules.captures(after, Side.Red).map(u => capture(after, u.value))
      Vector(Fen.board(fen).get, after) ++ hypotheticalCaptures
    for
      (position, index) <- positions.zipWithIndex
      side <- Side.values
    do
      val destinations = XiangqiRules.captures(position, side).map(u => Square.fromKey(u.dest).get).toSet
      for
        file <- 0 until 9
        rank <- 1 to 10
      do
        val target = Square(file, rank)
        assertEquals(
          XiangqiRules.canCaptureAt(position, side, target),
          destinations(target),
          s"board $index, $side, $target"
        )
