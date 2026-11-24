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

  test("rated friend games require three member snapshots and the pool clock"):
    val rank = lila.rating.ThreeKingdomsRank.initialSnapshot
    val g = game.copy(seats = users.map(id => Seat(Some(id), None, Some(rank))), rated = true)
    assertEquals(g.source, "friend")
    intercept[IllegalArgumentException](g.copy(clock = ClockState.start(ClockConfig(600, 60), 1000)))
    intercept[IllegalArgumentException](g.copy(seats = g.seats.updated(1, Seat(None, Some(2), None))))
    assert(g.takeback(users.head, 2000).isLeft)

  test("three human correspondence seats settle on their own track from placement"):
    val policy = lila.rating.ThreeKingdomsRank
    val track = lila.core.rank.RankTrackId.forMode(policy.catalog.track, true)
    val rank = policy.initialSnapshot.copy(track = track)
    val clock = ClockState.start(ClockConfig(0, 0, days = Some(2)), 1000)
    val g = game.copy(
      clock = clock,
      seats = users.map(id => Seat(Some(id), None, Some(rank))),
      rated = true,
      source = "seek"
    )
    assertEquals(g.accountTrack, track)
    assertEquals(
      policy.settleThree(g.seats.flatMap(_.rank), Vector(1d, 2d, 3d)).map(_.map(_.value)),
      Right(Vector(20, 0, -20))
    )
    intercept[IllegalArgumentException](
      g.copy(seats = g.seats.updated(0, g.seats.head.copy(rank = Some(policy.initialSnapshot))))
    )

  test("a public correspondence offer starts only when the last human seat is claimed"):
    val g = game
    val offer = KingdomChallenge(
      g.id,
      users.head,
      users.take(1),
      Set(users.head),
      ClockConfig(0, 0, days = Some(3)),
      g.createdAt,
      g.createdAt.plusSeconds(86400),
      openSeek = Some(true)
    )
    val waiting = offer.claimSeat(users(1))
    assertEquals(waiting.status, "pending")
    assertEquals(waiting.accepted, users.take(2).toSet)
    assertEquals(waiting.claimSeat(users(2)).status, "starting")
    val mixed = offer.copy(botLevel = Some(4)).claimSeat(users(1))
    assertEquals(mixed.status, "starting")
    assertEquals(
      mixed.arrangeSeats(mixed.users.map(_.value))(level => s"AI $level").toSet,
      Set(users.head.value, users(1).value, "AI 4")
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

  test("a friend game's bot is controlled by one surviving human at a time"):
    val mixed = game.copy(seats = game.seats.updated(Shu.ordinal, Seat(None, Some(3), None)))
    assertEquals(mixed.botHost, Some(users(Wei.ordinal)))
    assert(mixed.canMove(users(Wei.ordinal)))
    assert(!mixed.canMove(users(Wu.ordinal)))
    val duel = mixed.resign(users(Wei.ordinal), 2000).toOption.get
    assertEquals(duel.botHost, Some(users(Wu.ordinal)))
    assert(duel.canMove(users(Wu.ordinal)))
    assert(!duel.canMove(users(Wei.ordinal)))

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

  test("an invitation assigns the creator's requested side with either opponent lineup"):
    val g = game
    for
      requested <- Kingdom.values
      botLevel <- List(None, Some(4))
    do
      val humans = if botLevel.isDefined then users.take(2) else users
      val challenge = KingdomChallenge(
        g.id,
        humans.last,
        humans,
        Set(humans.last),
        g.clock.config,
        g.createdAt,
        g.createdAt.plusSeconds(600),
        botLevel = botLevel,
        creatorSide = Some(requested)
      )
      val seats = challenge.arrangeSeats(humans.map(_.value))(level => s"bot-$level")
      assertEquals(seats(requested.ordinal), humans.last.value)
      assertEquals(seats.toSet, humans.map(_.value).toSet ++ botLevel.map(level => s"bot-$level"))

  test("clock BSON preserves existing records and new time controls"):
    import reactivemongo.api.bson.*
    import BSONHandlers.given
    val codec = summon[BSONDocumentHandler[ClockConfig]]
    val original = BSONDocument("initialSeconds" -> 900, "moveSeconds" -> 60)
    assertEquals(codec.readTry(original).get, ClockConfig())
    val configs = List(
      ClockConfig(300, 30, Some(5), opening = Some(OpeningTime(2, 15))),
      ClockConfig(0, 0, days = Some(5)),
      ClockConfig(0, 0)
    )
    configs.foreach(config => assertEquals(codec.readTry(codec.writeTry(config).get).get, config))
