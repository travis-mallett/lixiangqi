package lila.threeKingdoms

class AdjudicationTest extends munit.FunSuite:
  import Kingdom.*
  import Role.*
  private def at(k: Kingdom, f: Int, r: Int) = Location(k, f, r)
  private def position(pieces: (Location, Piece)*): Position =
    val entries = (Kingdom.values.toVector.map(k => at(k, 4, 0) -> Piece(k, General)) ++ pieces).toMap
    Position.initial.copy(board = Location.all.map(entries.get), repetitions = Vector.empty)

  test("voluntary self-check is forbidden in both phases"):
    val from = at(Shu, 4, 1)
    val p = position(
      from -> Piece(Shu, Chariot),
      at(Shu, 4, 4) -> Piece(Wei, Chariot),
      at(Wei, 4, 1) -> Piece(Wei, Advisor)
    )
    val exposesKing = Move(from, at(Shu, 3, 1))
    assert(!Rules.legalMoves(p).contains(exposesKing))
    val duel = Rules.withdraw(p, Wu).toOption.get.position
    assert(!Rules.legalMoves(duel).contains(exposesKing))

  test("stalemate on entering a final duel loses immediately"):
    val p = position(
      at(Wei, 3, 1) -> Piece(Shu, Chariot),
      at(Wei, 5, 1) -> Piece(Shu, Chariot),
      at(Shu, 4, 1) -> Piece(Shu, Soldier),
      at(Wu, 4, 1) -> Piece(Wu, Advisor)
    ).copy(turn = Wei)
    assert(!Rules.checked(p, Wei))
    val end = Rules.withdraw(p, Wu).toOption.get.position
    assert(end.finished)
    assertEquals(end.eliminated.map(_.reason), Vector(LossReason.Resignation, LossReason.Stalemate))
    assertEquals(end.placement(Shu), Some(1d))
    assertEquals(PositionCodec.read(PositionCodec.write(end)), Right(end))

  test("flying-general capture can cross either branch of the center file"):
    val p = position()
    assert(Rules.pseudoMoves(p, Shu).contains(Move(at(Shu, 4, 0), at(Wu, 4, 0))))
    assert(Rules.pseudoMoves(p, Shu).contains(Move(at(Shu, 4, 0), at(Wei, 4, 0))))

  test("two whole turn cycles returning to the same position cause threefold repetition"):
    var p = Position.initial
    for _ <- 0 until 2 do
      for (from, to) <- Vector((0, 1), (1, 0)); army <- Kingdom.cycle do
        p = Rules.play(p, Move(at(army, 0, from), at(army, 0, to))).toOption.get.position
    assertEquals(p.ending.map(_.reason), Some(EndReason.Repetition))
    assertEquals(p.active.map(p.placement), Set[Option[Double]](Some(2d)))

  test("quiet thresholds and irreversible moves reset exactly as published"):
    val p = Position.initial.copy(quietPlies = 179)
    val quiet = Rules.play(p, Move(at(Shu, 0, 0), at(Shu, 0, 1))).toOption.get.position
    assertEquals(quiet.ending.map(_.reason), Some(EndReason.NoProgress))
    val soldier = Rules.play(p, Move(at(Shu, 0, 3), at(Shu, 0, 4))).toOption.get.position
    assertEquals(soldier.quietPlies, 0)
    assert(!soldier.finished)

  test("record actors cannot impersonate another player's turn"):
    assert(Rules.event(Position.initial, Wei, Rules.legalMoves(Position.initial).head.key).isLeft)

  test("engine takes a hanging opposing general"):
    val p = position(at(Wu, 4, 1) -> Piece(Shu, Chariot), at(Wei, 4, 1) -> Piece(Wei, Advisor))
    val result = Engine.search(p, 1, 1000)
    assert(result.lines.head.line.headOption.exists(m => p.piece(m.to).exists(_.role == General)))

  test("no pass is available in the new rules"):
    assert(Rules.event(Position.initial, Shu, "pass").isLeft)

  test("no safe response permits the general to take a defended checking rook"):
    val p = position(
      at(Shu, 4, 1) -> Piece(Wei, Chariot),
      at(Shu, 4, 2) -> Piece(Shu, Soldier),
      at(Shu, 4, 3) -> Piece(Wei, Cannon),
      at(Shu, 3, 2) -> Piece(Wu, Chariot),
      at(Shu, 5, 2) -> Piece(Wu, Chariot),
      at(Wei, 4, 1) -> Piece(Wei, Advisor),
      at(Wu, 4, 1) -> Piece(Wu, Advisor)
    )
    assert(Rules.noSafeEscape(p))
    val response = Move(at(Shu, 4, 0), at(Shu, 4, 1))
    assert(Rules.legalMoves(p).contains(response))
    val next = Rules.play(p, response).toOption.get.position
    assert(next.active.contains(Shu))
    assert(Rules.checked(next, Shu))
    assertEquals(next.turn, Wu)

  test("unchecked withdrawal removes its army"):
    val next = Rules.withdraw(Position.initial, Wu, timeout = true).toOption.get.position
    assert(!next.board.flatten.exists(_.army == Wu))
    assertEquals(next.controllers(Wu.ordinal), None)
    assertEquals(next.active, Set(Shu, Wei))

  test("hundreds of generated transitions round-trip and replay without losing ownership"):
    var p = Position.initial
    val random = new scala.util.Random(42)
    for _ <- 0 until 250 do
      if p.finished then p = Position.initial
      val legal = Rules.legalMoves(p)
      val action = legal(random.nextInt(legal.size)).key
      val next = Rules.event(p, p.turn, action).toOption.get
      assertEquals(PositionCodec.read(PositionCodec.write(next)), Right(next))
      p = next

  test("only safe check responses are legal when an escape exists"):
    val p = position(
      at(Shu, 4, 3) -> Piece(Wei, Chariot),
      at(Shu, 0, 0) -> Piece(Shu, Chariot),
      at(Wei, 4, 1) -> Piece(Wei, Advisor),
      at(Wu, 4, 1) -> Piece(Wu, Advisor)
    )
    assert(Rules.checked(p, Shu))
    assert(!Rules.noSafeEscape(p))
    assert(Rules.legalMoves(p).nonEmpty)
    assert(!Rules.legalMoves(p).contains(Move(at(Shu, 0, 0), at(Shu, 0, 1))))
    assertEquals(Rules.legalMoves(p), Rules.safeMoves(p, Shu))

  private def nearStalemate = position(
    at(Wei, 0, 2) -> Piece(Shu, Chariot),
    at(Wei, 5, 1) -> Piece(Shu, Chariot),
    at(Shu, 4, 1) -> Piece(Shu, Advisor),
    at(Wu, 4, 1) -> Piece(Wu, Advisor),
    at(Wu, 0, 0) -> Piece(Wu, Chariot)
  )

  test("stalemate credit survives an unrelated third-player move"):
    val closed = Rules.play(nearStalemate, Move(at(Wei, 0, 2), at(Wei, 3, 2))).toOption.get.position
    assertEquals(closed.turn, Wu)
    assertEquals(closed.stalemateCredit(Wei.ordinal), Some(Shu))
    assert(closed.active.contains(Wei))
    val lost = Rules.play(closed, Move(at(Wu, 0, 0), at(Wu, 0, 1))).toOption.get.position
    assertEquals(lost.eliminated.head, Elimination(Wei, LossReason.Stalemate, 2))
    assertEquals(lost.controllers(Wei.ordinal), Some(Shu))
    assert(lost.fallen(lost.piece(at(Wei, 4, 0)).get))
    assertEquals(PositionCodec.read(PositionCodec.write(lost)), Right(lost))

  test("third player can restore an escape before stalemate is judged"):
    val p =
      nearStalemate.copy(board = nearStalemate.board.updated(at(Wei, 2, 1).index, Some(Piece(Wu, Cannon))))
    val closed = Rules.play(p, Move(at(Wei, 0, 2), at(Wei, 3, 2))).toOption.get.position
    val rescued = Rules.play(closed, Move(at(Wei, 2, 1), at(Wei, 3, 1))).toOption.get.position
    assertEquals(rescued.turn, Wei)
    assertEquals(rescued.active.size, 3)
    assertEquals(rescued.stalemateCredit(Wei.ordinal), None)
    assert(Rules.legalMoves(rescued).nonEmpty)

  test("double-check withdrawal chooses the checker next due, including an off-turn checker"):
    val p = position(
      at(Shu, 4, 2) -> Piece(Wei, Chariot),
      at(Shu, 3, 0) -> Piece(Wu, Chariot),
      at(Wei, 4, 1) -> Piece(Wei, Advisor),
      at(Wu, 4, 1) -> Piece(Wu, Advisor)
    )
    assertEquals(Rules.attackers(p, Shu), Set(Wei, Wu))
    assertEquals(Rules.withdraw(p, Shu).toOption.get.position.controllers(Shu.ordinal), Some(Wu))
    assertEquals(
      Rules.withdraw(p.copy(turn = Wei), Shu).toOption.get.position.controllers(Shu.ordinal),
      Some(Wei)
    )

  test("fallen generals block lines but neither move nor count as flying-general targets"):
    val p = position().copy(
      active = Set(Shu, Wu),
      controllers = Vector(Some(Shu), Some(Wu), Some(Shu)),
      eliminated = Vector(Elimination(Wei, LossReason.Resignation, 0))
    )
    assert(!Rules.pseudoMoves(p, Shu).exists(_.from == at(Wei, 4, 0)))
    assert(!Rules.pseudoMoves(p, Wu).contains(Move(at(Wu, 4, 0), at(Wei, 4, 0))))
    val withRook = p.copy(board = p.board.updated(at(Wei, 4, 1).index, Some(Piece(Wu, Chariot))), turn = Wu)
    assert(Rules.pseudoMoves(withRook, Wu).contains(Move(at(Wei, 4, 1), at(Wei, 4, 0))))

  test("a unilateral perpetual checker loses and the repeatedly checked player receives the army"):
    var p = position(
      at(Wei, 3, 2) -> Piece(Shu, Chariot),
      at(Shu, 4, 1) -> Piece(Shu, Advisor),
      at(Wu, 4, 1) -> Piece(Wu, Advisor),
      at(Wu, 0, 0) -> Piece(Wu, Chariot)
    )
    val cycle = Vector(
      Move(at(Wei, 3, 2), at(Wei, 4, 2)),
      Move(at(Wu, 0, 0), at(Wu, 0, 1)),
      Move(at(Wei, 4, 0), at(Wei, 3, 0)),
      Move(at(Wei, 4, 2), at(Wei, 3, 2)),
      Move(at(Wu, 0, 1), at(Wu, 0, 0)),
      Move(at(Wei, 3, 0), at(Wei, 4, 0))
    )
    for _ <- 0 until 2; move <- cycle do p = Rules.play(p, move).toOption.get.position
    assertEquals(p.eliminated.head.reason, LossReason.PerpetualCheck)
    assertEquals(p.eliminated.head.player, Shu)
    assertEquals(p.controllers(Shu.ordinal), Some(Wei))
    assertEquals(p.active, Set(Wei, Wu))
    assert(!p.finished)
    assertEquals(PositionCodec.read(PositionCodec.write(p)), Right(p))
