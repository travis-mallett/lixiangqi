package lila.threeKingdoms

class RulesTest extends munit.FunSuite:
  import Kingdom.*
  import Role.*

  private def at(k: Kingdom, f: Int, r: Int) = Location(k, f, r)
  private def position(pieces: (Location, Piece)*): Position =
    val entries = (Kingdom.values.toVector.map(k => at(k, 4, 0) -> Piece(k, General)) ++ pieces).toMap
    Position.initial.copy(board = Location.all.map(entries.get), repetitions = Vector.empty)

  test("initial position contains three complete armies and round-trips"):
    val p = Position.initial
    assertEquals(p.board.flatten.size, 48)
    Kingdom.values.foreach(k => assertEquals(p.board.flatten.count(_.army == k), 16))
    assertEquals(PositionCodec.read(PositionCodec.write(p)), Right(p))
    assert(Rules.legalMoves(p).nonEmpty)

  test("river crossings are reciprocal and the center file forks"):
    val center = at(Wei, 4, 4)
    assertEquals(Topology.across(center).toSet, Set(at(Wu, 4, 4), at(Shu, 4, 4)))
    Location.all
      .filter(_.rank == 4)
      .foreach: origin =>
        Topology.across(origin).foreach(destination => assert(Topology.across(destination).contains(origin)))

  test("all movement tables rotate by 120 degrees"):
    Location.all.foreach: origin =>
      assertEquals(
        Topology.rays(origin.rotate.index).flatten.toSet,
        Topology.rays(origin.index).flatten.map(_.rotate).toSet
      )
      assertEquals(
        Topology.horses(origin.rotate.index).toSet,
        Topology.horses(origin.index).map(j => Topology.Jump(j.to.rotate, j.blockedAt.rotate)).toSet
      )

  test("horse leg blocks a move across the river"):
    val from = at(Shu, 2, 3)
    val to = at(Wei, 5, 4)
    val p = position(from -> Piece(Shu, Horse))
    assert(Rules.pseudoMoves(p, Shu).contains(Move(from, to)))
    val blocked = p.copy(board = p.board.updated(at(Shu, 2, 4).index, Some(Piece(Wei, Soldier))))
    assert(!Rules.legalMoves(blocked).contains(Move(from, to)))

  test("cannon requires exactly one screen of any army"):
    val from = at(Shu, 0, 2)
    val to = at(Shu, 0, 4)
    val p = position(from -> Piece(Shu, Cannon), to -> Piece(Wu, Chariot))
    assert(!Rules.legalMoves(p).contains(Move(from, to)))
    val screened = p.copy(board = p.board.updated(at(Shu, 0, 3).index, Some(Piece(Wei, Soldier))))
    assert(Rules.pseudoMoves(screened, Shu).contains(Move(from, to)))

  test("capturing a general appropriates its army without changing original identities"):
    val from = at(Wu, 4, 1)
    val p = position(
      from -> Piece(Shu, Chariot),
      at(Wu, 0, 0) -> Piece(Wu, Chariot),
      at(Wei, 4, 1) -> Piece(Wei, Advisor)
    )
    val t = Rules.play(p, Move(from, at(Wu, 4, 0))).toOption.get
    assertEquals(t.appropriated, Set(Wu))
    assertEquals(t.position.active, Set(Shu, Wei))
    assertEquals(t.position.controllers(Wu.ordinal), Some(Shu))
    assertEquals(t.position.piece(at(Wu, 0, 0)), Some(Piece(Wu, Chariot)))
    assertEquals(t.position.placement(Wu), Some(3d))

  test("checked resignation transfers the army immediately and retires its general"):
    val p = position(
      at(Wu, 4, 1) -> Piece(Shu, Chariot),
      at(Wu, 0, 0) -> Piece(Wu, Horse),
      at(Wei, 4, 1) -> Piece(Wei, Advisor)
    )
    val abandoned = Rules.withdraw(p, Wu).toOption.get.position
    assert(abandoned.general(Wu).isDefined)
    assertEquals(abandoned.controllers(Wu.ordinal), Some(Shu))
    assertEquals(Rules.pseudoMoves(abandoned, Wu), Vector.empty)
    assert(!Rules.pseudoMoves(abandoned, Shu).exists(_.from == at(Wu, 4, 0)))
    assert(Rules.play(abandoned, Move(at(Wu, 4, 1), at(Wu, 4, 0))).isLeft)

  test("acquired soldiers retain their army's movement direction"):
    val p = Position.initial.copy(controllers = Vector(Some(Wei), Some(Shu), Some(Shu)))
    assertEquals(Topology.soldiers(at(Wu, 0, 3), Wu), Vector(at(Wu, 0, 4)))
    assert(Rules.pseudoMoves(p, Shu).exists(m => m.from == at(Wu, 0, 3) && m.to == at(Wu, 0, 4)))

  test("the cycle skips an eliminated player"):
    val p = position(at(Shu, 0, 1) -> Piece(Shu, Chariot), at(Wei, 4, 1) -> Piece(Wei, Advisor))
    val withdrawn = Rules.withdraw(p, Wu).toOption.get.position
    val moved = Rules.play(withdrawn, Move(at(Shu, 0, 1), at(Shu, 0, 2))).toOption.get.position
    assertEquals(moved.turn, Wei)

  test("the final resignation finishes the match and preserves all placements"):
    val first = Rules.withdraw(Position.initial, Wu).toOption.get.position
    val end = Rules.withdraw(first, Wei).toOption.get.position
    assert(end.finished)
    assertEquals(end.placement(Shu), Some(1d))
    assertEquals(end.placement(Wei), Some(2d))
    assertEquals(end.placement(Wu), Some(3d))
    assertEquals(PositionCodec.read(PositionCodec.write(end)), Right(end))

  test("repetition identity includes controllers and the player to move"):
    val p = Position.initial
    assertNotEquals(PositionCodec.repetitionKey(p), PositionCodec.repetitionKey(p.copy(turn = Wei)))
    assertNotEquals(
      PositionCodec.repetitionKey(p),
      PositionCodec.repetitionKey(p.copy(controllers = Vector(None, Some(Wu), Some(Shu))))
    )

  test("malformed positions cannot acquire active opponents' armies"):
    val p = Position.initial.copy(controllers = Vector(Some(Shu), Some(Wu), Some(Shu)))
    assert(PositionCodec.read(PositionCodec.write(p)).isLeft)
    assert(PositionCodec.read("rnbakabnr/9 w - - 0 1").isLeft)

  test("functional engine returns a legal move and respects its node budget"):
    val result = Engine.search(Position.initial, 3, 80)
    assert(result.lines.head.line.headOption.exists(Rules.legalMoves(Position.initial).contains))
    assert(result.nodes <= 80)
    assertEquals(result.lines.head.scores.size, 3)
