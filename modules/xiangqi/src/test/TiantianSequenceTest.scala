package lila.xiangqi.adjudication

import lila.xiangqi.Xiangqi.*
import lila.xiangqi.{ SpecialRulesExamples, XiangqiRules }

class TiantianSequenceTest extends munit.FunSuite:
  private def check(id: String = "r1") =
    MoveFact(Side.Red, id, Vector(id), Vector.empty, Vector.empty, false, false)
  private def chase(id: String = "r1", target: String = "b1") =
    MoveFact(Side.Red, id, Vector.empty, Vector(id), Vector(target), false, false)

  test("one, two, three, or four checking pieces cap at six, twelve, or eighteen checks"):
    for pieces <- 1 to 4 do
      val limit = 6 * pieces.min(3)
      val sequence = Vector.tabulate(limit)(i => check(s"r${i % pieces}"))
      assertEquals(TiantianSequences.forbidden(sequence.dropRight(1), sequence.last), None)
      assertEquals(TiantianSequences.forbidden(sequence, sequence.head), Some("perpetual-check"))

  test("a new checking piece extends six to twelve"):
    assertEquals(TiantianSequences.forbidden(Vector.fill(6)(check()), check("r2")), None)

  test("capture permits continuation and a quiet move resets a checking streak"):
    val history = Vector.fill(6)(check())
    assertEquals(TiantianSequences.forbidden(history, check().copy(capture = true)), None)
    assertEquals(TiantianSequences.forbidden(history :+ check().copy(checkers = Vector.empty), check()), None)

  test("one or multiple chasers of the same physical target have a six-move limit"):
    val history = Vector.tabulate(6)(i => chase(s"r${i % 2}"))
    assertEquals(TiantianSequences.forbidden(history, chase()), Some("perpetual-chase"))
    assertEquals(TiantianSequences.forbidden(history, chase(target = "b2")), None)

  test("checking takes priority over chasing"):
    val history = Vector.fill(6)(Vector(chase(), check("b1").copy(side = Side.Black))).flatten
    assertEquals(TiantianSequences.forbidden(history, chase()), None)
    assertEquals(
      TiantianSequences.forbidden(history, check("b1").copy(side = Side.Black)),
      Some("perpetual-check")
    )

  test("alternating check and chase requires variation after twelve or eighteen moves"):
    for pieces <- 1 to 2 do
      val limit = if pieces == 1 then 12 else 18
      val history = Vector.tabulate(limit)(i => if i % 2 == 0 then check("r1") else chase(s"r$pieces"))
      assertEquals(TiantianSequences.forbidden(history.dropRight(1), history.last), None)
      assertEquals(TiantianSequences.forbidden(history, check("r1")), Some("alternating-check-chase"))

  private def finishSequence(fen: String, history: Vector[MoveFact], move: String): State =
    val root = XiangqiRules.initialGame(Some(fen)).toOption.get
    // Supply classified history to exercise draw adjudication independently of threat classification.
    val states = root.state +: history.zipWithIndex.map((f, index) =>
      root.state.copy(
        ply = index + 1,
        adjudication = root.state.adjudication.map(_.copy(fact = Some(f)))
      )
    )
    val game = root.copy(
      states = states,
      moves = Vector.fill(history.size)(Uci.unsafe(move)),
      wxf = Vector.fill(history.size)("synthetic")
    )
    TiantianRules.afterMove(game, XiangqiRules.boardMove(game.state.fen, Uci.unsafe(move)).toOption.get)

  test("mutual checking draws at six turns each, not five"):
    val fen = SpecialRulesExamples.singlePiece.initialFen
    val pairs = Vector.fill(5)(Vector(check("black").copy(side = Side.Black), check("d8"))).flatten
    assert(!finishSequence(fen, pairs, SpecialRulesExamples.singlePiece.moves.head.value).ended)
    assertEquals(
      finishSequence(
        fen,
        pairs :+ check("black").copy(side = Side.Black),
        SpecialRulesExamples.singlePiece.moves.head.value
      ).termination,
      Some("mutual-check")
    )

  test("mutual chasing draws at six turns each against the same physical targets"):
    val fen = "4k4/9/9/9/1n7/4P4/R8/9/9/3K5 w - - 0 1"
    val pairs =
      Vector.fill(5)(Vector(chase("black", "red").copy(side = Side.Black), chase("a4", "b6"))).flatten
    assert(!finishSequence(fen, pairs, "a4b4").ended)
    assertEquals(
      finishSequence(fen, pairs :+ chase("black", "red").copy(side = Side.Black), "a4b4").termination,
      Some("mutual-chase")
    )
