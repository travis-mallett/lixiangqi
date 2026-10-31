package lila.xiangqi

import munit.FunSuite
import Xiangqi.*

class JieqiTest extends FunSuite:
  private def play(game: Game, move: String): Game =
    XiangqiRules.move(game, Uci.unsafe(move)).flatMap(game.applyMove).fold(fail(_), identity)

  test("shuffle preserves each side's inventory and public initial states are identical"):
    val games = Vector.fill(20)(Jieqi.initial().fold(fail(_), identity))
    assert(games.forall(_.deal.get.validate.isRight))
    assertEquals(games.map(_.state).distinct.size, 1)
    assert(games.map(_.deal.get.identities).distinct.size > 1)
    assertEquals(Fen.board(games.head.state.fen).get.concealed.size, 30)
    assertEquals(games.head.state.variant, "jieqi")

  test("a hidden pawn slot moves as a pawn then reveals its assigned identity"):
    val game = Jieqi.initial().fold(fail(_), identity)
    val after = play(game, "a4a5")
    val board = Fen.board(after.state.fen).get
    assertEquals(board.pieceAt("a5").map(_.role), Some(game.deal.get.at("a4")))
    assertEquals(board.concealed.size, 29)
    assert(!game.state.legalMoves.contains(Uci.unsafe("a4b4")))
    assertEquals(game.deal, after.deal)

  test("captured hidden identities are visible only to the capturer"):
    val game = Jieqi.initial().fold(fail(_), identity)
    val after = play(game, "b3b10")
    assertEquals(after.state.captures.size, 1)
    assertEquals(Jieqi.captures(after, None).head.role, None)
    assertEquals(Jieqi.captures(after, Some(Side.Black)).head.role, None)
    assertEquals(Jieqi.captures(after, Some(Side.Red)).head.role, Some(game.deal.get.at("b10").key))
    assert(after.state.captures.head.concealed)

  test("revealed advisors and elephants cross the river while generals remain in the palace"):
    val fen = "4k4/9/9/9/4p4/3AB4/9/9/9/4K4 w j - 0 1"
    val moves = XiangqiRules.legalMoves(fen).fold(fail(_), identity)
    assert(moves.contains(Uci.unsafe("d5c6")))
    assert(moves.contains(Uci.unsafe("e5g7")))
    assert(!moves.contains(Uci.unsafe("e1e4")))

  test("hypothetical analysis requires a reveal, never a secret deal"):
    val game = Jieqi.initial().fold(fail(_), identity).copy(deal = None)
    assert(Jieqi.move(game, Uci.unsafe("a4a5")).isLeft)
    val result = Jieqi.move(game, Uci.unsafe("a4a5"), Some(Role.Chariot)).fold(fail(_), identity)
    assertEquals(Fen.board(result.fen).get.pieceAt("a5"), Some(Piece(Side.Red, Role.Chariot)))

  test("public replay reconstructs every reveal without access to the private deal"):
    val initial = Jieqi.initial().fold(fail(_), identity)
    val captured = play(initial, "b3b10")
    val replay = XiangqiRules.game(captured.position).fold(fail(_), identity)
    assertEquals(replay.deal, None)
    assertEquals(replay.state, captured.state)
    assertEquals(Jieqi.observation(captured, None), Jieqi.observation(captured, Some(Side.Black)))
    assertNotEquals(Jieqi.observation(captured, None), Jieqi.observation(captured, Some(Side.Red)))
    assertEquals(Jieqi.publicStates(captured, Some(Side.Red)).head.captures, Vector.empty)

  test("reveals cannot manufacture pieces or change an already revealed piece"):
    val game = Jieqi.initial().fold(fail(_), identity).copy(deal = None)
    assert(Jieqi.analysisMove(game, Uci.unsafe("a4a5"), Some("general")).isLeft)
    assert(Jieqi.analysisMove(game, Uci.unsafe("a4a5"), Some("dragon")).isLeft)
    assert(Jieqi.analysisMove(game, Uci.unsafe("e1e2"), Some("chariot")).isLeft)
    assert(Jieqi.withKnownCaptures(game, Map("a1" -> "general")).isLeft)

  test("Jieqi notation round trips chance outcomes and retains distinct reveal branches"):
    val text = s"""[Variant "Jieqi"]
                  |[FEN "${Jieqi.startFen}"]
                  |1. a4a5~chariot (1. a4a5~horse) a7a6~cannon *""".stripMargin
    val tree = XiangqiNotation.importTree(NotationImport(notation = text)).fold(fail(_), identity)
    assertEquals(tree.children.size, 2)
    assertNotEquals(tree.children.head.state.fen, tree.children(1).state.fen)
    val roundTrip = XiangqiNotation
      .importTree(NotationImport(notation = XiangqiNotation.exportTree(tree)))
      .fold(fail(_), identity)
    assertEquals(roundTrip.children, tree.children)

  test("a long deterministic game keeps secrets out of public state and can survive reconstruction"):
    var game = Jieqi.initial().fold(fail(_), identity)
    for _ <- 0 until 60 if !game.state.ended do
      val move = game.state.legalMoves.head
      game = XiangqiRules.move(game, move).flatMap(game.applyMove).fold(fail(_), identity)
      assertEquals(game.states.size, game.moves.size + 1)
      assertEquals(
        Fen.board(game.state.fen).get.concealed.size + game.state.captures.count(_.concealed) +
          game.states
            .sliding(2)
            .count(pair =>
              Fen.board(pair.head.fen).get.concealed.exists(_.key == game.moves(pair.head.ply).orig)
            ),
        30
      )
