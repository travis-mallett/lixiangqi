package lila.round

import chess.{ ByColor, Color, Rated }

import scala.collection.mutable.ListBuffer

import lila.core.fishnet.{ AiMoveRequestId, AiTurnKey, FishnetMoveRequest }
import lila.core.game.{ Game, Player, Source }
import lila.core.id.{ GameId, GamePlayerId }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

class AiTurnCoordinatorTest extends munit.FunSuite:

  test("a takeback replaces the pending turn and rejects responses from its abandoned attempts"):
    var now = 1_000L
    val requests = ListBuffer.empty[FishnetMoveRequest]
    val scheduled = ListBuffer.empty[(FiniteDuration, AiTurnKey)]
    val coordinator = AiTurnCoordinator(
      scheduleDue = (delay, key) => scheduled += delay -> key,
      tooManyPlies = () => fail("unexpected maximum-ply resignation"),
      publish = requests += _,
      currentTimeMillis = () => now
    )
    val original = aiGame(Color.White)
    val originalKey = AiTurnKey.from(original).getOrElse(fail("missing original AI turn key"))

    coordinator.observe(original)
    assertEquals(scheduled.toList, List(2.seconds -> originalKey))
    now += 2_000
    coordinator.due(original, originalKey)
    val originalRequest = requests.last
    assert(coordinator.accepts(original, originalKey, originalRequest.requestId))

    val humanTurn = play(original)
    coordinator.observe(humanTurn)
    assert(!coordinator.accepts(humanTurn, originalKey, originalRequest.requestId))

    val advanced = play(humanTurn)
    val advancedKey = AiTurnKey.from(advanced).getOrElse(fail("missing advanced AI turn key"))
    assertNotEquals(advancedKey, originalKey)
    coordinator.observe(advanced, force = true)
    val advancedRequest = requests.last
    assert(!coordinator.accepts(advanced, originalKey, originalRequest.requestId))
    assert(coordinator.accepts(advanced, advancedKey, advancedRequest.requestId))

    // Returning to the exact same history deliberately recreates the semantic
    // key, but starts a fresh logical request.
    coordinator.observe(original, force = true)
    val replayedRequest = requests.last
    assertEquals(replayedRequest.turnKey, originalKey)
    assertNotEquals(replayedRequest.requestId, originalRequest.requestId)
    assert(!coordinator.accepts(original, originalKey, originalRequest.requestId))
    assert(coordinator.accepts(original, originalKey, replayedRequest.requestId))

  test("the watchdog retries a current turn with one stable idempotency ID"):
    var now = 10_000L
    val requests = ListBuffer.empty[FishnetMoveRequest]
    val game = aiGame(Color.White)
    val coordinator = AiTurnCoordinator(
      scheduleDue = (_, _) => (),
      tooManyPlies = () => fail("unexpected maximum-ply resignation"),
      publish = requests += _,
      currentTimeMillis = () => now
    )

    coordinator.observe(game, force = true)
    val first = requests.last
    now += AiTurnCoordinator.retryDelay(1).toMillis - 1
    coordinator.tick(game)
    assertEquals(requests.size, 1)

    now += 1
    coordinator.tick(game)
    assertEquals(requests.size, 2)
    val retry = requests.last
    assertEquals(retry.requestId, first.requestId)
    assert(coordinator.accepts(game, first.turnKey, first.requestId))
    assert(coordinator.accepts(game, retry.turnKey, retry.requestId))

  test("an unissued request ID is rejected even when its turn key is current"):
    val requests = ListBuffer.empty[FishnetMoveRequest]
    val game = aiGame(Color.White)
    val coordinator = AiTurnCoordinator(
      scheduleDue = (_, _) => (),
      tooManyPlies = () => fail("unexpected maximum-ply resignation"),
      publish = requests += _
    )

    coordinator.observe(game, force = true)
    val request = requests.last
    assert(!coordinator.accepts(game, request.turnKey, AiMoveRequestId("not-issued")))

  test("duplicate worker-ready signals do not immediately duplicate work"):
    var now = 20_000L
    val requests = ListBuffer.empty[FishnetMoveRequest]
    val game = aiGame(Color.White)
    val coordinator = AiTurnCoordinator(
      scheduleDue = (_, _) => (),
      tooManyPlies = () => fail("unexpected maximum-ply resignation"),
      publish = requests += _,
      currentTimeMillis = () => now
    )

    coordinator.observe(game, force = true)
    coordinator.observe(game, force = true)
    assertEquals(requests.size, 1)

    now += 1_000
    coordinator.observe(game, force = true)
    assertEquals(requests.size, 2)

  test("a failed logical request is retried immediately with the same idempotency ID"):
    val now = 30_000L
    val requests = ListBuffer.empty[FishnetMoveRequest]
    val game = aiGame(Color.White)
    val coordinator = AiTurnCoordinator(
      scheduleDue = (_, _) => (),
      tooManyPlies = () => fail("unexpected maximum-ply resignation"),
      publish = requests += _,
      currentTimeMillis = () => now
    )

    coordinator.observe(game, force = true)
    val failed = requests.last
    coordinator.failed(game, failed.turnKey, failed.requestId, retryImmediately = true)
    assert(coordinator.accepts(game, failed.turnKey, failed.requestId))

    coordinator.tick(game)
    val retry = requests.last
    assertEquals(requests.size, 2)
    assertEquals(retry.requestId, failed.requestId)
    assert(coordinator.accepts(game, retry.turnKey, retry.requestId))

  test("the existing maximum-ply policy resigns without publishing work"):
    var resigned = false
    val requests = ListBuffer.empty[FishnetMoveRequest]
    val base = aiGame(Color.White)
    val state = base.xiangqi.state.copy(ply = lila.core.fishnet.maxPlies + 1)
    val longGame = base.copy(
      xiangqi = Xiangqi.Game.fromState(base.xiangqi.initialFen, state).fold(fail(_), identity)
    )
    val coordinator = AiTurnCoordinator(
      scheduleDue = (_, _) => (),
      tooManyPlies = () => resigned = true,
      publish = requests += _
    )

    coordinator.observe(longGame, force = true)
    assert(resigned)
    assertEquals(requests.toList, Nil)

  private def aiGame(aiColor: Color): Game =
    lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(
          Player(GamePlayerId("red1"), Color.White, aiLevel = (aiColor == Color.White).option(5)),
          Player(GamePlayerId("black1"), Color.Black, aiLevel = (aiColor == Color.Black).option(5))
        ),
        rated = Rated.No,
        source = Source.Ai,
        pgnImport = None
      )
      .withId(GameId("aitest01"))
      .start

  private def play(game: Game): Game =
    val uci = game.position.legalMoves.headOption.getOrElse(fail("expected a legal move"))
    val move = XiangqiRules.move(game.xiangqi, uci).fold(fail(_), identity)
    val xiangqi = game.xiangqi.applyMove(move).fold(fail(_), identity)
    game.copy(xiangqi = xiangqi)
