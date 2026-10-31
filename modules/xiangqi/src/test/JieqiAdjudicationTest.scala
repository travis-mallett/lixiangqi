package lila.xiangqi.adjudication

import lila.xiangqi.{ Jieqi, XiangqiRules }
import lila.xiangqi.Xiangqi.*

class JieqiAdjudicationTest extends munit.FunSuite:
  test("the seventh check by the same physical piece is forbidden; changing checker breaks the streak"):
    def check(id: String) = MoveFact(Side.Red, id, Vector(id), Vector.empty, Vector.empty, false, false)
    val six = Vector.fill(6)(check("a1"))
    assertEquals(TiantianSequences.forbiddenJieqi(six.init, six.last), None)
    assertEquals(TiantianSequences.forbiddenJieqi(six, check("a1")), Some("perpetual-check"))
    assertEquals(TiantianSequences.forbiddenJieqi(six, check("b1")), None)
    assertEquals(TiantianSequences.forbiddenJieqi(six :+ check("b1"), check("a1")), None)

  test("changing chasers does not reset a chase of the same physical target"):
    def chase(id: String, target: String) =
      MoveFact(Side.Red, id, Vector.empty, Vector(id), Vector(target), false, false)
    val six = Vector.tabulate(6)(i => chase(s"r$i", "a10"))
    assertEquals(TiantianSequences.forbiddenJieqi(six, chase("r7", "a10")), Some("perpetual-chase"))
    assertEquals(TiantianSequences.forbiddenJieqi(six, chase("r7", "b10")), None)

  test("revealing a piece does not reset the eighty-ply no-capture limit; capturing does"):
    val initial = Jieqi.initial().toOption.get
    val state = initial.state.copy(adjudication = initial.state.adjudication.map(_.copy(naturalPlies = 79)))
    val seeded = initial.copy(states = Vector(state))
    val quiet = XiangqiRules.move(seeded, Uci.unsafe("a4a5")).toOption.get
    assertEquals(quiet.termination, Some("no-capture"))
    val capture = XiangqiRules.move(seeded, Uci.unsafe("b3b10")).toOption.get
    assertEquals(capture.adjudication.get.naturalPlies, 0)
    assertEquals(capture.termination, None)

  test("the fifth repeated position draws; Jieqi has no insufficient attacking material draw"):
    var game = XiangqiRules.initialGame(Some("4k4/9/9/9/4p4/9/9/9/9/4K4 w j - 0 1")).toOption.get
    assert(!game.state.ended)
    val cycle = Vector("e1d1", "e10d10", "d1e1", "d10e10")
    // Use a central blocker on both files so that the generals never face.
    game = XiangqiRules.initialGame(Some("4k4/9/9/9/3pp4/9/9/9/9/4K4 w j - 0 1")).toOption.get
    for index <- 0 until 16 do
      game =
        XiangqiRules.move(game, Uci.unsafe(cycle(index % 4))).flatMap(game.applyMove).fold(fail(_), identity)
      if index < 15 then assert(!game.state.ended)
    assertEquals(game.state.termination, Some("repetition"))
