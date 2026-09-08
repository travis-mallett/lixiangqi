package lila.xiangqi

import lila.xiangqi.Xiangqi.*
import lila.xiangqi.adjudication.{ Ruleset, TiantianRules }

class TiantianRulesTest extends munit.FunSuite:
  private def initial(fen: String = startFen) = XiangqiRules.initialGame(Some(fen)).toOption.get
  private def play(game: Game, moves: String*): Game =
    moves.foldLeft(game): (g, u) =>
      val result = XiangqiRules.move(g, Uci.unsafe(u)).fold(fail(_), identity)
      g.applyMove(result).fold(fail(_), identity)

  test("new games default to a concrete Tiantian version; analysis stays unrestricted"):
    assertEquals(initial().ruleset, Ruleset.Tiantian)
    assertEquals(Position().ruleset, Ruleset.Unrestricted)
    assert(Ruleset.fromKey("wxf").isLeft)

  test("fifth quiet position is an automatic draw, not the third"):
    val cycle = Seq("b1c3", "b10c8", "c3b1", "c8b10")
    val third = play(initial(), Seq.fill(2)(cycle).flatten*)
    assert(!third.state.ended)
    val fifth = play(third, Seq.fill(2)(cycle).flatten*)
    assertEquals(fifth.state.gameResult, Result.Draw)
    assertEquals(fifth.state.termination, Some("repetition"))
    assert(XiangqiRules.move(fifth, Uci.unsafe("b1c3")).isLeft)
    assertEquals(XiangqiRules.game(fifth.position).toOption.get, fifth)

  test("unrestricted custom games can continue a quiet repetition"):
    val game = XiangqiRules.initialGame(ruleset = Ruleset.Unrestricted).toOption.get
    val repeated = play(game, Seq.fill(5)(Seq("b1c3", "b10c8", "c3b1", "c8b10")).flatten*)
    assert(!repeated.state.ended)

  test("a rook chasing the same horse is restricted after six chases"):
    val root = initial("4k4/9/9/9/1n7/4P4/R8/9/9/3K5 w - - 0 1")
    val six = play(
      root,
      "a4b4",
      "b6c8",
      "b4c4",
      "c8b6",
      "c4b4",
      "b6c8",
      "b4c4",
      "c8b6",
      "c4b4",
      "b6c8",
      "b4c4",
      "c8b6"
    )
    assertEquals(six.state.variation, Some("perpetual-chase"))
    assert(!six.state.legalMoves.contains(Uci.unsafe("c4b4")))
    assertEquals(six.state.adjudication.get.identities("b6"), "b6")

  test("a king or soldier attacking a non-king does not count as a chase"):
    val root = initial("4k4/9/9/9/1n7/P3P4/9/9/9/3K5 w - - 0 1")
    val next = play(root, "a5a6")
    assertEquals(next.state.adjudication.get.fact.get.targets, Vector.empty)

  test("a protected horse is not a qualifying chase target"):
    val root = initial("4k4/9/9/9/1nr6/4P4/R8/9/9/3K5 w - - 0 1")
    assertEquals(play(root, "a4b4").state.adjudication.get.fact.get.targets, Vector.empty)

  test("stalemate is a win, including on the natural limit"):
    val root = initial("4k4/9/3R1R3/9/9/4P4/9/9/R8/3K5 w - - 0 1")
    val seeded = root.copy(states =
      Vector(
        root.state.copy(
          adjudication = root.state.adjudication.map(_.copy(naturalPlies = 119))
        )
      )
    )
    val next = play(seeded, "a2a9")
    assert(!next.state.check)
    assertEquals(next.state.gameResult, Result.RedWin)
    assertEquals(next.state.termination, Some("stalemate"))

  test("400 total played plies end the game, irrespective of captures or FEN numbering"):
    val root = initial(startFen.replace("0 1", "0 200"))
    val at398 = root.copy(
      moves = Vector.fill(398)(Uci.unsafe("a4a5")),
      wxf = Vector.fill(398)("P9+1"),
      states = Vector.fill(399)(root.state)
    )
    val at399 = play(at398, "b1c3")
    assert(!at399.state.ended)
    assertEquals(play(at399, "b10c8").state.termination, Some("move-limit"))

  test("one piece may give six checks; its seventh check is unavailable"):
    val example = SpecialRulesExamples.singlePiece
    val root = initial(example.initialFen)
    val six = play(root, example.moves.take(12).map(_.value)*)
    assert(!six.state.ended)
    assertEquals(six.state.variation, Some("perpetual-check"))
    assert(!six.state.legalMoves.contains(example.moves.last))
    assert(XiangqiRules.move(six, example.moves.last).left.toOption.get.contains("Must vary"))
    val varied = play(six, "f8f7", "e10e9")
    assertEquals(varied.state.variation, None)

  test("no attacking material on either side is an automatic draw"):
    val game = initial("3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1")
    assertEquals(game.state.gameResult, Result.Draw)
    assertEquals(game.state.termination, Some("no-attacking-material"))
    assert(!game.state.redInsufficientMaterial) // Do not activate chess timeout/claim exceptions.

  test("a side loses when every supplied board-legal continuation requires variation"):
    val example = SpecialRulesExamples.singlePiece
    val root = initial(example.initialFen)
    val checked = play(root, example.moves.take(11).map(_.value)*)
    val response = XiangqiRules.boardMove(checked.state.fen, example.moves(11)).toOption.get
    // Isolate exhaustion of the supplied board-legal move list from board move generation.
    val state = TiantianRules.afterMove(checked, response.copy(legalMoves = Vector(example.moves.last)))
    assertEquals(state.gameResult, Result.BlackWin)
    assertEquals(state.termination, Some("forced-variation"))
    assert(state.legalMoves.isEmpty)

  test("a soldier, including a last-rank soldier, prevents the material draw"):
    assert(!initial("P2k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1").state.ended)

  test("natural draw occurs at 120 counted plies"):
    val root = initial()
    val at119 = root.copy(states =
      Vector(
        root.state.copy(
          adjudication = root.state.adjudication.map(_.copy(naturalPlies = 119))
        )
      )
    )
    assertEquals(play(at119, "b1c3").state.termination, Some("no-capture"))

  test("checks above each player's separate allowance do not increment the natural counter"):
    val example = SpecialRulesExamples.singlePiece
    val root = initial(example.initialFen)
    val seeded = root.copy(states =
      Vector(
        root.state.copy(
          adjudication =
            root.state.adjudication.map(_.copy(naturalPlies = 119, redChecks = 10, blackChecks = 0))
        )
      )
    )
    val checked = play(seeded, example.moves.head.value)
    assertEquals(checked.state.adjudication.get.naturalPlies, 119)
    assertEquals(checked.state.adjudication.get.redChecks, 11)
    assert(!checked.state.ended)
    assertEquals(play(checked, example.moves(1).value).state.termination, Some("no-capture"))

  test("captures reset both checking allowances and the natural counter"):
    val root = initial("4k4/9/9/9/9/4P4/9/9/p8/R3K4 w - - 17 9")
    val seeded = root.copy(states =
      Vector(
        root.state.copy(
          adjudication =
            root.state.adjudication.map(_.copy(naturalPlies = 119, redChecks = 10, blackChecks = 12))
        )
      )
    )
    val next = play(seeded, "a1a2").state.adjudication.get
    assertEquals((next.naturalPlies, next.redChecks, next.blackChecks), (0, 0, 0))

  test("mate wins on the natural limit"):
    val root = initial("4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1")
    val seeded = root.copy(states =
      Vector(
        root.state.copy(
          adjudication = root.state.adjudication.map(_.copy(naturalPlies = 119))
        )
      )
    )
    val next = play(seeded, "a3e3")
    assertEquals(next.state.gameResult, Result.RedWin)
    assertEquals(next.state.termination, Some("checkmate"))

  test("custom FEN fullmove and halfmove fields do not invent a played history"):
    val game = initial(startFen.replace("0 1", "119 250"))
    assert(!play(game, "b1c3").state.ended)
    assertEquals(play(game, "b1c3").state.adjudication.get.naturalPlies, 1)

  test("rewinding snapshots restores counters and piece identities"):
    val root = initial()
    val moved = play(root, "b1c3", "b10c8")
    val back = moved.copy(
      moves = moved.moves.dropRight(1),
      wxf = moved.wxf.dropRight(1),
      states = moved.states.dropRight(1)
    )
    assertEquals(play(back, "b10c8"), moved)
