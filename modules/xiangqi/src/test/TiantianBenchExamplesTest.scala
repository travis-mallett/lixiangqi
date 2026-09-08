package lila.xiangqi

import Xiangqi.*

/** Every script here is played from its declared FEN with zero hidden history. */
class TiantianBenchExamplesTest extends munit.FunSuite:
  private def play(game: Game, move: Uci): Game =
    XiangqiRules.move(game, move).flatMap(game.applyMove).fold(fail(_), identity)
  private def facts(game: Game) = game.states.flatMap(_.adjudication.flatMap(_.fact))
  private def replay(example: SpecialRulesExamples.Example, accepted: Int): Game =
    val root = XiangqiRules.initialGame(Some(example.initialFen)).fold(fail(_), identity)
    assert(!root.state.ended)
    assertEquals(root.state.adjudication.get.naturalPlies, 0)
    assertEquals(root.state.adjudication.get.fact, None)
    example.moves
      .take(accepted)
      .zipWithIndex
      .foldLeft(root): (game, step) =>
        val (move, index) = step
        assert(game.state.legalMoves.contains(move), s"${example.id} ply ${index + 1}: ${move.value}")
        val next = play(game, move)
        assert(!next.state.ended, s"${example.id} ended at ply ${index + 1}")
        next

  private def rejected(example: SpecialRulesExamples.Example, accepted: Int, reason: String): Game =
    assertEquals(example.moves.size, accepted + 1)
    val game = replay(example, accepted)
    val board = XiangqiRules.boardMove(game.state.fen, example.moves.last).fold(fail(_), identity)
    assert(!board.capture)
    assert(!board.state.ended, "A terminal exception must not explain a rejected attempt")
    assertEquals(game.state.variation, Some(reason))
    assert(!game.state.legalMoves.contains(example.moves.last))
    assertEquals(XiangqiRules.move(game, example.moves.last), Left(s"Must vary: $reason"))
    assertEquals(XiangqiRules.game(game.position), Right(game))
    val rewind = game.copy(
      moves = game.moves.dropRight(2),
      wxf = game.wxf.dropRight(2),
      states = game.states.dropRight(2)
    )
    assertEquals(game.moves.takeRight(2).foldLeft(rewind)(play), game)
    game

  test("quiet variation permits six NEW checks and rejects only their seventh"):
    val game = rejected(SpecialRulesExamples.singleRestart, 26, "perpetual-check")
    val red = facts(game).filter(_.side == Side.Red)
    assertEquals(red.map(_.check), Vector.fill(6)(true) ++ Vector(false) ++ Vector.fill(6)(true))
    assert(red.forall(!_.chase))
    assert(facts(game).forall(!_.capture))
    assertEquals(red.flatMap(_.checkers).toSet, Set("d8"))
    assertEquals(
      game.states(13).adjudication.get.redChecks,
      6,
      "Quiet breaks the streak, not the cumulative allowance"
    )
    assertEquals(game.state.adjudication.get.redChecks, 12)

  test("seventh check can mate: the ordinary seventh check in the SAME position is prohibited"):
    val example = SpecialRulesExamples.singleMate
    val game = replay(example, 12)
    val red = facts(game).filter(_.side == Side.Red)
    assertEquals(red.size, 6)
    assert(red.forall(_.check))
    assertEquals(red.flatMap(_.checkers).toSet, Set("e1"))
    assert(facts(game).forall(!_.capture))
    val ordinary = Uci.unsafe("g7e8")
    val ordinaryBoard = XiangqiRules.boardMove(game.state.fen, ordinary).fold(fail(_), identity)
    assert(ordinaryBoard.check && !ordinaryBoard.state.ended && !ordinaryBoard.capture)
    assertEquals(XiangqiRules.move(game, ordinary), Left("Must vary: perpetual-check"))
    val won = play(game, example.moves.last)
    assertEquals(won.state.termination, Some("checkmate"))
    assertEquals(won.state.gameResult, Result.RedWin)
    assertEquals(won.state.adjudication.get.fact.get.checkers, Vector("e1"))
    assert(!won.state.adjudication.get.fact.get.capture)
    assertEquals(won.state.adjudication.get.redChecks, 7)
    assertEquals(XiangqiRules.game(won.position), Right(won))

  for (example, capturePly, accepted) <- Vector(
      (SpecialRulesExamples.checkerCapture, 3, 16),
      (SpecialRulesExamples.defenderCapture, 2, 14)
    )
  do
    test(s"${example.id}: either side's capture resets history and grants six fresh checks"):
      val game = rejected(example, accepted, "perpetual-check")
      assertEquals(facts(game).zipWithIndex.collect { case (f, i) if f.capture => i + 1 }, Vector(capturePly))
      val reset = game.states(capturePly).adjudication.get
      assertEquals((reset.naturalPlies, reset.redChecks, reset.blackChecks), (0, 0, 0))
      assertEquals(game.states(capturePly - 1).adjudication.get.redChecks, 1)
      val newChecks = facts(game).drop(capturePly).filter(_.side == Side.Red)
      assertEquals(newChecks.size, 6)
      assert(newChecks.forall(_.check))
      assertEquals(newChecks.flatMap(_.checkers).toSet, Set("d8"))
      assertEquals(game.state.adjudication.get.redChecks, 6)

  for (example, accepted, restart) <- Vector(
      (SpecialRulesExamples.chase, 12, false),
      (SpecialRulesExamples.chaseRestart, 26, true)
    )
  do
    test(s"${example.id}: isolate chasing from checking and quiet repetition"):
      val game = rejected(example, accepted, "perpetual-chase")
      val red = facts(game).filter(_.side == Side.Red)
      assert(facts(game).forall(f => !f.capture && !f.check))
      val expected = if restart then Vector.fill(6)(true) ++ Vector(false) ++ Vector.fill(6)(true)
      else Vector.fill(6)(true)
      assertEquals(red.map(_.chase), expected)
      assertEquals(red.flatMap(_.targets).toSet, Set("b6"))
      assertEquals(red.flatMap(_.chasers).toSet, Set("a4"))
      assert(facts(game).filter(_.side == Side.Black).forall(!_.forcing))

  for (example, limit, attackers) <- Vector(
      (SpecialRulesExamples.alternatingSingle, 12, Set("c8")),
      (SpecialRulesExamples.alternatingMultiple, 18, Set("d8", "a4"))
    )
  do
    test(s"${example.id}: alternate every turn so neither consecutive check nor chase can explain rejection"):
      val game = rejected(example, limit * 2, "alternating-check-chase")
      val red = facts(game).filter(_.side == Side.Red)
      assertEquals(red.map(_.check), Vector.tabulate(limit)(_ % 2 == 0))
      assertEquals(red.map(_.chase), Vector.tabulate(limit)(_ % 2 == 1))
      assertEquals(red.flatMap(f => f.checkers ++ f.chasers).toSet, attackers)
      assertEquals(red.flatMap(_.targets).toSet, Set("b6"))
      assert(facts(game).forall(!_.capture))
      assert(facts(game).filter(_.side == Side.Black).forall(!_.check))

  test("quiet repetition: fourth occurrence remains playable, fifth draws without forcing or move limits"):
    val example = SpecialRulesExamples.quietRepetition
    val before = replay(example, 15)
    val draw = play(before, example.moves.last)
    assert(facts(draw).forall(f => !f.forcing && !f.responding && !f.capture))
    assertEquals(draw.state.adjudication.get.naturalPlies, 16)
    assertEquals(draw.state.termination, Some("repetition"))
    assertEquals(draw.state.gameResult, Result.Draw)
    assertEquals(XiangqiRules.game(draw.position), Right(draw))

  test("120-ply natural limit has a complete quiet history and no overlapping repetition"):
    val example = SpecialRulesExamples.naturalLimit
    assertEquals(example.moves.size, 120)
    val before = replay(example, 119)
    assertEquals(before.state.adjudication.get.naturalPlies, 119)
    val ended = play(before, example.moves.last)
    assert(facts(ended).forall(f => !f.capture && !f.forcing && !f.responding))
    val occurrences = ended.states.groupBy(_.fen.split(' ').take(2).mkString(" ")).values.map(_.size)
    assert(occurrences.max < 5)
    assertEquals(ended.state.termination, Some("no-capture"))
    assertEquals(ended.state.gameResult, Result.Draw)

  test("400-ply total limit has real capture resets and remains below the natural limit"):
    val example = SpecialRulesExamples.totalLimit
    assertEquals(example.moves.size, 400)
    val before = replay(example, 399)
    val ended = play(before, example.moves.last)
    assertEquals(
      facts(ended).zipWithIndex.collect { case (f, i) if f.capture => i + 1 },
      Vector(91, 185, 279, 373)
    )
    for ply <- Vector(91, 185, 279, 373) do assertEquals(ended.states(ply).adjudication.get.naturalPlies, 0)
    assertEquals(ended.state.adjudication.get.naturalPlies, 27)
    assertEquals(ended.state.termination, Some("move-limit"))
    assertEquals(ended.state.gameResult, Result.Draw)
    assert(facts(ended).forall(!_.check))

  test("capture of the last attacking piece demonstrates material draw without a hidden history"):
    val example = SpecialRulesExamples.materialDraw
    val before = replay(example, 0)
    assert(before.state.check)
    val ended = play(before, example.moves.head)
    assert(ended.state.adjudication.get.fact.get.capture)
    assertEquals(ended.state.termination, Some("no-attacking-material"))
    assertEquals(ended.state.gameResult, Result.Draw)

  for (example, reason) <- Vector(
      SpecialRulesExamples.mutualChase -> "mutual-chase",
      SpecialRulesExamples.mutualCheck -> "mutual-check"
    )
  do
    test(s"${example.id}: five turns each and six-versus-five stay ongoing, six each draws"):
      val before = replay(example, 11)
      val ended = play(before, example.moves.last)
      assertEquals(ended.state.termination, Some(reason))
      assertEquals(ended.state.gameResult, Result.Draw)
      assert(facts(ended).forall(!_.capture))
      for side <- Side.values do
        val own = facts(ended).filter(_.side == side)
        assertEquals(own.size, 6)
        if reason == "mutual-check" then assert(own.forall(f => f.check && !f.chase))
        else
          assert(own.forall(f => f.chase && !f.check))
          assertEquals(own.map(_.targets.toSet).reduce(_ intersect _).size, 1)
      assertEquals(XiangqiRules.game(ended.position), Right(ended))

  test("alternation restarts after a quiet move, allowing twelve fresh turns before rejecting a chase"):
    val game = rejected(SpecialRulesExamples.alternatingRestart, 50, "alternating-check-chase")
    val own = facts(game).filter(_.side == Side.Red)
    assertEquals(own.size, 25)
    assert(!own(12).forcing)
    assertEquals(own.take(12).map(_.check), Vector.tabulate(12)(_ % 2 == 0))
    assertEquals(own.drop(13).map(_.check), Vector.tabulate(12)(_ % 2 == 1))
    assertEquals(own.drop(13).map(_.chase), Vector.tabulate(12)(_ % 2 == 0))
    assertEquals(own.flatMap(f => f.checkers ++ f.chasers).toSet, Set("c8"))
    assert(facts(game).forall(!_.capture))
