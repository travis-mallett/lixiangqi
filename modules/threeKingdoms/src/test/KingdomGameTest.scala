package lila.threeKingdoms

class KingdomGameTest extends munit.FunSuite:
  import Kingdom.*
  val users = Vector(UserId("wei-player"), UserId("wu-player"), UserId("shu-player"))
  private def game = KingdomGame(
    GameId("testgame"),
    users.map(id => Seat(Some(id), None, None)),
    Position.initial,
    Position.initial,
    ClockState.start(ClockConfig(), 1000),
    java.time.Instant.ofEpochMilli(1000),
    java.time.Instant.ofEpochMilli(1000)
  )

  test("three immutable seats control moves and a spectator has no write authority"):
    val g = game
    val move = Rules.legalMoves(g.position).head.key
    assert(g.move(UserId("spectator"), move, 2000).isLeft)
    assert(g.move(users(Wei.ordinal), move, 2000).isLeft)
    val moved = g.move(users(Shu.ordinal), move, 2000).toOption.get
    assertEquals(moved.position.turn, Wu)
    assertEquals(moved.events.head.actor, Shu)
    assertEquals(moved.events.head.clocks, Vector(900000L, 900000L, 899000L))
    assertEquals(KingdomGame.replay(moved.initial, moved.events), Right(moved.position))

  test("leaving the game by resignation revokes moves but preserves the seat and replay"):
    val lost = game.resign(users(Shu.ordinal), 2000).toOption.get
    assertEquals(lost.playerOf(users(Shu.ordinal)), Some(Shu))
    assert(!lost.canMove(users(Shu.ordinal)))
    assertEquals(lost.seats, game.seats)
    assert(lost.resign(users(Shu.ordinal), 3000).isLeft)
    assertEquals(KingdomGame.replay(lost.initial, lost.events), Right(lost.position))

  test("server deadlines cannot be extended by sending a move at expiry"):
    val g = game
    val action = Rules.legalMoves(g.position).head.key
    assert(g.move(users(Shu.ordinal), action, 60999).isRight)
    assert(g.move(users(Shu.ordinal), action, 61000).isLeft)
    val flagged = g.flag(61000).get
    assertEquals(flagged.position.eliminated.head.reason, LossReason.Timeout)
    assertEquals(flagged.position.turn, Wu)
    assertEquals(flagged.clock.deadline(flagged.position), Some(121000L))

  test("a draw requires all surviving humans, without an eliminated spectator's consent"):
    val first = game.draw(users(0), 2000).toOption.get
    val second = first.draw(users(1), 3000).toOption.get
    assert(!second.position.finished)
    assert(second.draw(users(2), 4000).toOption.get.position.ending.exists(_.draw))
    val duel = game.resign(users(1), 2000).toOption.get
    val drawn = duel.draw(users(0), 3000).toOption.get.draw(users(2), 4000).toOption.get
    assert(drawn.position.ending.exists(_.draw))
    assertEquals(drawn.position.placement(Wu), Some(3d))
    assertEquals(drawn.position.placement(Wei), Some(1.5d))

  test("human elimination immediately finishes computer play and preserves replay"):
    val g = game.copy(seats = Vector(Seat(None, Some(2), None), Seat(None, Some(2), None), game.seats(2)))
    val watching = g.resign(users(2), 2000).toOption.get
    assert(!watching.unattendedDuel)
    assert(watching.position.finished)
    assertEquals(watching.position.placement(Shu), Some(3d))
    assertEquals(watching.position.placement(Wei), Some(1.5d))
    assertEquals(KingdomGame.replay(watching.initial, watching.events), Right(watching.position))
    assert(!watching.canMove(users(2)))
    assert(!watching.canMove(UserId("spectator")))
    assert(!watching.canMove(users(0)))

  test("the stored aggregate round-trips with all three seats, clock, and ownership"):
    import BSONHandlers.given
    val handler = summon[reactivemongo.api.bson.BSONDocumentHandler[KingdomGame]]
    val g = game.resign(users(1), 2000).toOption.get
    assertEquals(handler.readDocument(handler.writeTry(g).get).get, g)

  test("takeback in the final duel does not require an earlier eliminated spectator"):
    val duel = game.resign(users(1), 2000).toOption.get
    val moved = duel.move(users(2), Rules.legalMoves(duel.position).head.key, 3000).toOption.get
    assert(moved.takeback(users(1), 4000).isLeft)
    val offer = moved.takeback(users(0), 4000).toOption.get
    assertEquals(offer.position, moved.position)
    val accepted = offer.takeback(users(2), 5000).toOption.get
    assertEquals(accepted.position, duel.position)
    assertEquals(accepted.events, duel.events)
    assert(accepted.takebackOffers.isEmpty)

  test("computer takeback returns to the human's decision, and tournament moves cannot be undone"):
    val start = game.copy(seats = Vector(Seat(None, Some(1), None), Seat(None, Some(1), None), game.seats(2)))
    val played = (0 until 3).foldLeft(start): (g, n) =>
      g.move(users(2), Rules.legalMoves(g.position).head.key, 2000 + n * 1000).toOption.get
    assertEquals(played.takeback(users(2), 6000).toOption.get.position, start.position)
    assert(played.copy(tournamentId = Some(TourId("tourney1"))).takeback(users(2), 6000).isLeft)

  test("guest completion validates and archives a finished unranked game"):
    val events = Vector(RecordedAction("resign", Shu, 2000, Vector.fill(3)(900000L)))
    val g = LocalCompletion.game(GameId("guestest"), Shu, 2, ClockConfig(), events, 3000).toOption.get
    assert(!g.unattendedDuel)
    assert(g.position.finished)
    assert(g.userIds.isEmpty)
    assert(g.botHost.isEmpty)
    assert(!g.rated)
    assert(g.seats(Shu.ordinal).guest)
    assert(!g.canMove(UserId("local")))
    assertEquals(KingdomGame.replay(g.initial, g.events), Right(g.position))
    import BSONHandlers.given
    val handler = summon[reactivemongo.api.bson.BSONDocumentHandler[KingdomGame]]
    assertEquals(handler.readDocument(handler.writeTry(g).get).get, g)
    assert(LocalCompletion.game(g.id, Wei, 2, ClockConfig(), events, 3000).isLeft)
    assert(LocalCompletion.game(g.id, Shu, 2, ClockConfig(), Vector.empty, 3000).isLeft)
    assert(
      LocalCompletion.game(g.id, Shu, 2, ClockConfig(), events.map(_.copy(clocks = Vector(-1))), 3000).isLeft
    )
    assert(
      LocalCompletion.game(g.id, Shu, 2, ClockConfig(), events.map(_.copy(action = "pass")), 3000).isLeft
    )

  test("guest completion stops the clock after an off-turn resignation"):
    val moved = game.move(users(Shu.ordinal), Rules.legalMoves(game.position).head.key, 2000).toOption.get
    val departed = moved.resign(users(Shu.ordinal), 3000).toOption.get
    val hosted = LocalCompletion
      .game(GameId("guest002"), Shu, 2, ClockConfig(), departed.events, 7000, 5000)
      .toOption
      .get
    assertEquals(hosted.clock.startedAt, 7000L)
    assertEquals(hosted.deadline, None)
    assertEquals(hosted.clock.remaining, departed.clock.display(departed.position, 7000))
