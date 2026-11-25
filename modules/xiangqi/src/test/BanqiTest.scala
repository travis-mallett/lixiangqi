package lila.xiangqi

import Xiangqi.*

class BanqiTest extends munit.FunSuite:
  private def game(fen: String) = Banqi.analysis(fen).fold(fail(_), identity)
  private def advance(g: Game, move: String, reveal: Option[String] = None) =
    Banqi.advance(g, Uci.unsafe(move), reveal).flatMap(g.applyMove).fold(fail(_), identity)
  private def diagram(bottom: String, turn: String = "w", quiet: Int = 0, bag: String = "-") =
    game(s"4/4/4/4/4/4/4/$bottom $turn banqi r $quiet 16 $bag")

  test("opening seat stays fixed after either colour; independent identical public histories"):
    val layouts = Vector(Banqi.inventory, Banqi.inventory.take(1) + Banqi.inventory.tail.reverse)
    val games = layouts.map(layout => Banqi.initial(Banqi.Deal.read(layout).toOption.get).toOption.get)
    val flip = Uci.unsafe("a1a1")
    assertEquals(games.head.state.legalMoves.size, 32)
    assertEquals(games.map(g => XiangqiRules.move(g, flip)).distinct.size, 1)
    for face <- Vector("N", "n") do
      val next = advance(game(Banqi.startFen), "a1a1", Some(face))
      assertEquals(next.state.turn, Side.Black)
      assertEquals(
        Banqi.read(next.state.fen).toOption.get.movingArmy,
        Some(if face == "n" then Side.Red else Side.Black)
      )
      assertEquals(next.state.legalMoves.size, 31)
      assertEquals(next.chineseWxf, Vector(s"a1($face)"))
      assertEquals(XiangqiRules.game(next.position).map(_.states), Right(next.states))
      assert(Banqi.advance(next, flip, Some(face)).isLeft)

  test("every ordinary capture pair, with the general and soldier exceptions"):
    val ranks = "KABRNCP"
    for (attacker, i) <- ranks.zipWithIndex; (victim, j) <- ranks.toLowerCase.zipWithIndex do
      val g = diagram(s"$attacker${victim}2")
      val allowed = attacker match
        case 'C' => false
        case 'P' => "kp".contains(victim)
        case 'K' => victim != 'p'
        case _ => i <= j
      assertEquals(g.state.legalMoves.contains(Uci.unsafe("a1b1")), allowed, s"$attacker x $victim")

  test("cannon jumps one screen; passing and capturing covers are illegal"):
    val g = game("4/4/4/k3/4/*3/4/C3 w banqi r 0 10 P")
    assert(g.state.legalMoves.contains(Uci.unsafe("a1a5")))
    for fen <- List("4/4/4/k3/*3/*3/4/C3 w banqi r 0 10 PP", "4/4/4/*3/4/*3/4/C3 w banqi r 0 10 kP") do
      assert(!game(fen).state.legalMoves.contains(Uci.unsafe("a1a5")))
    assertEquals(advance(g, "a1a5").state.termination, Some("elimination"))
    val surviving = advance(diagram("Pk*1", bag = "n"), "a1b1")
    assertEquals(surviving.state.gameResult, Result.Ongoing)
    assert(surviving.state.legalMoves.contains(Uci.unsafe("c1c1")))

  test("third occurrence and 30 quiet plies, reset and decisive precedence"):
    val base = diagram("K2k")
    val cycle = List("a1a2", "d1d2", "a2a1", "d2d1")
    val twice = cycle.foldLeft(base)((g, move) => advance(g, move))
    assert(!twice.state.ended)
    assertEquals(
      cycle.foldLeft(twice)((g, move) => advance(g, move)).state.termination,
      Some("threefold-repetition")
    )
    assertEquals(advance(diagram("K2k", quiet = 29), "a1a2").state.termination, Some("noProgress"))
    assert(!advance(diagram("K2k", quiet = 28), "a1a2").state.ended)
    assert(!advance(diagram("K*1k", quiet = 29, bag = "N"), "b1b1", Some("N")).state.ended)
    assert(!advance(diagram("Pkp1", quiet = 29), "a1b1").state.ended)
    val blocked = game("4/4/4/4/4/4/1R2/p1R1 w banqi r 29 19 -")
    val locked = advance(blocked, "b2a2")
    // b1 is still available here; the equivalent corner with b1 occupied is immobilized.
    assertEquals(locked.state.gameResult, Result.Draw)
    val corner = game("4/4/4/4/4/4/1R2/pR2 w banqi r 29 19 -")
    assertEquals(advance(corner, "b2a2").state.termination, Some("immobilization"))

  test("competition records preserve both outcomes on the same square"):
    val source = "[Variant \"Banqi\"]\n1. b3(n) (1. b3(P)) 1... c2(K) *"
    val imported =
      XiangqiNotation.importTree(NotationImport(Xiangqi.startFen, source)).fold(fail(_), identity)
    assertEquals(imported.children.map(_.state.reveal), Vector(Some("n"), Some("P")))
    val exported = XiangqiNotation.exportTree(imported)
    val back = XiangqiNotation.importTree(NotationImport(Xiangqi.startFen, exported)).fold(fail(_), identity)
    assertEquals(back.children, imported.children)
