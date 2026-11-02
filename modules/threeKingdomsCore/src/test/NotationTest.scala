package lila.threeKingdoms

class NotationTest extends munit.FunSuite:
  private def move(value: String) = Move.parse(value).get
  private def notation(value: String, p: Position = Position.initial) = Notation(p, move(value))

  test("coordinates uniquely cover all three territories, from riverbank to back rank") {
    assertEquals(Location.all.map(Notation.square).distinct.size, 135)
    assertEquals(Notation.square(Location(Kingdom.Shu, 0, 0)), "1E")
    assertEquals(Notation.square(Location(Kingdom.Shu, 8, 4)), "9A")
    assertEquals(Notation.square(Location(Kingdom.Wu, 0, 0)), "1J")
    assertEquals(Notation.square(Location(Kingdom.Wu, 8, 4)), "9F")
    assertEquals(Notation.square(Location(Kingdom.Wei, 0, 0)), "1O")
    assertEquals(Notation.square(Location(Kingdom.Wei, 8, 4)), "9K")
  }

  test("local moves retain WXF piece letters, directions, distances and destination files") {
    assertEquals(notation("shu:1:0>shu:2:2"), "H2E+3")
    assertEquals(notation("shu:2:0>shu:4:2"), "E3E+5")
    assertEquals(notation("shu:3:0>shu:4:1"), "A4E+5")
    assertEquals(notation("shu:1:2>shu:4:2"), "C2C=5")
    assertEquals(notation("shu:1:2>shu:1:1"), "C2C-1")
    assertEquals(notation("shu:0:0>shu:0:2"), "R1E+2")
    assertEquals(notation("shu:0:3>shu:0:4"), "P1B+1")
    assertEquals(notation("wu:1:0>wu:2:2"), "H2J+3")
    assertEquals(notation("wei:1:0>wei:2:2"), "H2O+3")
  }

  test("river crossings name exact destinations, including both center-file exits") {
    assertEquals(notation("shu:1:2>wei:7:4"), "C2C>8K")
    val from = Location(Kingdom.Shu, 4, 4)
    val p = Position.initial.copy(board =
      Position.initial.board.updated(from.index, Some(Piece(Kingdom.Shu, Role.Chariot)))
    )
    assertEquals(Notation(p, Move(from, Location(Kingdom.Wei, 4, 4))), "R5A>5K")
    assertEquals(Notation(p, Move(from, Location(Kingdom.Wu, 4, 4))), "R5A>5F")
  }

  test("an invading or appropriated army keeps its own advance direction") {
    val from = Location(Kingdom.Wei, 7, 4)
    val p = Position.initial.copy(
      board = Position.initial.board.updated(from.index, Some(Piece(Kingdom.Shu, Role.Chariot))),
      controllers = Vector.fill(3)(Some(Kingdom.Wu)),
      turn = Kingdom.Wu
    )
    assertEquals(notation("wei:7:4>wei:7:2", p), "R8K+2")
    assertEquals(notation("wei:7:4>shu:1:4", p), "R8K>2A")
  }

  test("every mechanically possible move is distinct, including duplicate pieces and acquired armies") {
    for army <- Kingdom.values; role <- Role.values do
      val p = Position.initial.copy(
        board = Vector.fill(135)(Some(Piece(army, role))),
        controllers = Vector.fill(3)(Some(Kingdom.Shu))
      )
      val moves = Location.all.flatMap { from =>
        val destinations = role match
          case Role.Horse => Topology.horses(from.index).map(_.to)
          case Role.Elephant => Topology.elephants(from.index).map(_.to)
          case Role.Advisor => Topology.advisors(from.index)
          case Role.Soldier => Topology.soldiers(from, army)
          case _ => Topology.rays(from.index).flatten
        destinations.distinct.map(Move(from, _))
      }
      val tokens = moves.map(Notation(p, _))
      assertEquals(tokens.distinct.size, moves.size, s"$army $role")
      assert(tokens.forall(_.length <= 7))
  }
