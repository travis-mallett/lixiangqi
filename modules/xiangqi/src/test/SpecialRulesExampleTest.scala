package lila.xiangqi

class SpecialRulesExampleTest extends munit.FunSuite:
  private val originalIds = Set("single-chariot-check", "two-piece-check", "three-piece-check")
  private val terminalOutcomes = Map(
    "single-check-mate-exception" -> ("checkmate", "1-0"),
    "quiet-repetition" -> ("repetition", "1/2-1/2"),
    "natural-move-limit" -> ("no-capture", "1/2-1/2"),
    "total-move-limit" -> ("move-limit", "1/2-1/2"),
    "last-attacker-captured" -> ("no-attacking-material", "1/2-1/2"),
    "mutual-chase" -> ("mutual-chase", "1/2-1/2"),
    "mutual-check" -> ("mutual-check", "1/2-1/2")
  )
  private val longIds = Set("natural-move-limit", "total-move-limit")
  private val longCheckPlies = Set(1, 91, 185, 279, 373)

  for example <- SpecialRulesExamples.all do
    test(s"${example.id}: playback agrees with live transitions, including rejection and rewind"):
      var live = XiangqiRules.initialGame(Some(example.initialFen), example.ruleset).fold(fail(_), identity)
      assertEquals(example.at(0), Right(SpecialRulesExamples.Playback(live, None)))
      example.moves.zipWithIndex.foreach: (uci, index) =>
        val expected = XiangqiRules.move(live, uci) match
          case Left(error) =>
            SpecialRulesExamples.Playback(live, Some(SpecialRulesExamples.Attempt(index + 1, uci, error)))
          case Right(result) =>
            live = live.applyMove(result).fold(fail(_), identity)
            SpecialRulesExamples.Playback(live, None)
        val ply = index + 1
        val selected = !longIds(example.id) || longCheckPlies(ply) || ply >= example.moves.size - 2
        if selected then
          val actual = example.at(ply)
          assertEquals(actual, Right(expected))
          if ply < example.moves.size then
            assertEquals(
              actual.toOption.flatMap(_.rejected),
              None,
              s"${example.id} rejected before final input"
            )
            assert(!actual.toOption.exists(_.game.state.ended), s"${example.id} ended before final input")
      val end = example.at(example.moves.size).fold(fail(_), identity)
      terminalOutcomes.get(example.id) match
        case Some((termination, result)) =>
          assertEquals(end.rejected, None, s"${example.id} should end in an accepted terminal position")
          assert(end.game.state.ended, s"${example.id} must end the game")
          assertEquals(end.game.state.termination, Some(termination))
          assertEquals(end.game.state.gameResult.key, result)
        case None =>
          assert(end.game.state.ended == false, s"${example.id} unexpectedly ended before its rejected input")
          assert(end.rejected.isDefined, s"${example.id} should expose a prohibited final attempt")
          assertEquals(example.at(example.moves.size - 1), Right(end.copy(rejected = None)))
      val rewindPly = (example.moves.size - 3).max(0)
      val rewind = example.at(rewindPly).fold(fail(_), identity)
      assertEquals(rewind.rejected, None)
      assertEquals(rewind.game.state.adjudication, live.states(rewindPly).adjudication)
      assertEquals(example.at(example.moves.size), Right(end))

    test(s"${example.id}: notation includes the attempt and input is bounded"):
      assertEquals(example.labels.fold(fail(_), identity).map(_._1), example.moves)
      assertEquals(SpecialRulesExamples.get(example.id), Some(example))
      assert(example.at(-1).isLeft)
      assert(example.at(example.moves.size + 1).isLeft)

  test("registry IDs are unique and unknown IDs are rejected"):
    assertEquals(SpecialRulesExamples.all.map(_.id).distinct.size, SpecialRulesExamples.all.size)
    assert(originalIds.subsetOf(SpecialRulesExamples.all.map(_.id).toSet))
    assert(terminalOutcomes.keySet.subsetOf(SpecialRulesExamples.all.map(_.id).toSet))
    assert(SpecialRulesExamples.get("unknown").isEmpty)
