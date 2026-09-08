package lila.xiangqi

import Xiangqi.*
import adjudication.Ruleset

/** Board-generated forcing facts complement the compact synthetic sequence tests. */
class TiantianExamplesTest extends munit.FunSuite:
  private val examples = Vector(
    (SpecialRulesExamples.singlePiece, 6, Set("d8")),
    (SpecialRulesExamples.twoPieces, 12, Set("f7", "i8")),
    (SpecialRulesExamples.threePieces, 18, Set("b8", "g6", "h7"))
  )

  for (example, checks, expectedCheckers) <- examples do
    test(s"${example.id}: $checks legal checks, physical identities, rejection and variation"):
      assertEquals(example.ruleset, Ruleset.Tiantian)
      assert(Fen.isValid(example.initialFen))
      val board = Fen.board(example.initialFen).get
      for side <- Side.values do
        val generals = board.pieces.filter((_, piece) => piece == Piece(side, Role.General))
        assertEquals(generals.size, 1)
        assert(
          generals.keys.forall(s =>
            s.file >= 3 && s.file <= 5 &&
              (if side == Side.Red then s.rank >= 1 && s.rank <= 3 else s.rank >= 8 && s.rank <= 10)
          )
        )
        assert(XiangqiRules.checkingPieces(board, side).isEmpty)
        for role <- Vector(Role.Chariot, Role.Horse, Role.Cannon) do
          assert(board.pieces.values.count(_ == Piece(side, role)) <= 2)
      val acceptedPlies = checks * 2
      assertEquals(example.moves.size, acceptedPlies + 1)
      var live = XiangqiRules.initialGame(Some(example.initialFen), example.ruleset).fold(fail(_), identity)
      assert(!live.state.ended)
      example.moves
        .take(acceptedPlies)
        .zipWithIndex
        .foreach: (uci, index) =>
          assert(live.state.legalMoves.contains(uci), s"ply ${index + 1}: ${uci.value}")
          val result = XiangqiRules.move(live, uci).fold(fail(_), identity)
          assert(!result.capture, s"ply ${index + 1} must not reset the streak")
          live = live.applyMove(result).fold(fail(_), identity)
          assert(!live.state.ended, s"premature ending at ply ${index + 1}")
          val fact = live.state.adjudication.get.fact.get
          assertEquals(fact.side, if index % 2 == 0 then Side.Red else Side.Black)
          assertEquals(fact.check, index % 2 == 0, s"check classification at ply ${index + 1}")
          assertEquals(live.state.check, fact.check)

      val redFacts = live.states.flatMap(_.adjudication.flatMap(_.fact)).filter(_.side == Side.Red)
      assertEquals(redFacts.size, checks)
      assertEquals(redFacts.flatMap(_.checkers).toSet, expectedCheckers)
      assertEquals(live.state.adjudication.get.redChecks, checks)
      assertEquals(live.state.adjudication.get.blackChecks, 0)
      assertEquals(live.state.variation, Some("perpetual-check"))
      assertEquals(live.state.gameResult, Result.Ongoing)
      val attempted = example.moves.last
      val boardLegal = XiangqiRules.boardMove(live.state.fen, attempted).fold(fail(_), identity)
      assert(boardLegal.check)
      assert(!boardLegal.capture)
      assert(!live.state.legalMoves.contains(attempted))
      assertEquals(XiangqiRules.move(live, attempted), Left("Must vary: perpetual-check"))
      if example == SpecialRulesExamples.twoPieces then
        assertEquals(attempted.value, "e8g9")
        assertEquals(XiangqiRules.wxf(live.state.fen, attempted), Right("H5+3"))
        assertEquals(
          redFacts.flatMap(_.checkers).groupMapReduce(identity)(_ => 1)(_ + _),
          Map("f7" -> 10, "i8" -> 2)
        )
        assertEquals(XiangqiRules.checkingPieces(Fen.board(boardLegal.fen).get, Side.Red), Vector("g9"))
      assertEquals(XiangqiRules.game(live.position), Right(live))

      val rewind = live.copy(
        moves = live.moves.dropRight(2),
        wxf = live.wxf.dropRight(2),
        states = live.states.dropRight(2)
      )
      val restored = live.moves
        .takeRight(2)
        .foldLeft(rewind): (game, move) =>
          XiangqiRules.move(game, move).flatMap(game.applyMove).fold(fail(_), identity)
      assertEquals(restored, live)
      val varying = live.state.legalMoves.iterator.flatMap: move =>
        XiangqiRules
          .move(live, move)
          .toOption
          .filter: result =>
            !result.state.ended && result.adjudication.flatMap(_.fact).exists(f => !f.forcing && !f.capture)
      val variation = varying.take(1).toList.headOption.getOrElse(fail("No legal quiet variation remains"))
      val varied = live.applyMove(variation).fold(fail(_), identity)
      assert(!varied.state.ended)
      assertEquals(varied.state.variation, None)
