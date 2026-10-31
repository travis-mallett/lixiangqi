package lila.threeKingdoms

class EngineTest extends munit.FunSuite:
  test("MultiPV ranks distinct legal roots at completed depths and streams within one budget"):
    val p = Position.initial
    val updates = scala.collection.mutable.ArrayBuffer.empty[Engine.Result]
    val result = Engine.search(
      p,
      3,
      500,
      5,
      r =>
        updates += r; ()
    )
    assert(result.nodes <= 500)
    assert(updates.nonEmpty)
    assertEquals(updates.map(_.depth).toVector, (1 to result.depth).toVector)
    updates.foreach: update =>
      assertEquals(update.lines.size, 5)
      assertEquals(update.lines.map(_.line.head).distinct.size, 5)
      val scores = update.lines.map(_.scores(p.turn.ordinal))
      assertEquals(scores, scores.sorted.reverse)
      update.lines.foreach: line =>
        var current = p
        line.line.foreach: move =>
          current = Rules.play(current, move).toOption.get.position
        assertEquals(line.scores, Engine.evaluate(current))
        assertEquals(line.active, current.active)
        assertEquals(line.winners, current.ending.map(_.winners))
        assertEquals(line.line.length, update.depth)
    val single = Engine.search(p, 3, 500)
    assertEquals(result.lines.head, single.lines.head)
    assertEquals(result.depth, single.depth)
    assertEquals(result.nodes, single.nodes)

  test("an incomplete first iteration is never advertised as a completed search"):
    var updates = 0
    val result = Engine.search(Position.initial, 6, 1, 5, _ => updates += 1)
    assertEquals(result.depth, 0)
    assertEquals(result.nodes, 1)
    assertEquals(updates, 0)
    assert(Rules.legalMoves(Position.initial).contains(result.lines.head.line.head))

  test("terminal evaluations retain the actual winners and do no search work"):
    val p = Rules.event(Position.initial, Position.initial.turn, "draw").toOption.get
    val result = Engine.search(p, 6, 1000, 5)
    assertEquals(result.nodes, 0)
    assertEquals(result.lines.head.winners, p.ending.map(_.winners))
    assertEquals(result.lines.head.line, Vector.empty)
