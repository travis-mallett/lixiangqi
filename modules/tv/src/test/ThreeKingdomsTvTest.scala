package lila.tv

import lila.threeKingdoms.*

class ThreeKingdomsTvTest extends munit.FunSuite:
  private val game = KingdomGame(
    GameId("tvking01"),
    Vector("red", "blue", "green").map(id => Seat(Some(UserId(id)), None, None)),
    Position.initial,
    Position.initial,
    ClockState.start(ClockConfig(), 1000),
    java.time.Instant.ofEpochMilli(1000),
    java.time.Instant.ofEpochMilli(1000)
  )

  test("a quiet channel retains the last broadcast and its latest revision"):
    assertEquals(ThreeKingdomsTv.choose(Some(game), Nil, None), Some(game))
    val updated = game.copy(revision = 1)
    assertEquals(ThreeKingdomsTv.choose(Some(game), Nil, Some(updated)), Some(updated))
    assertEquals(ThreeKingdomsTv.choose(Some(updated), Nil, Some(game)), Some(updated))

  test("a new live game replaces a retained broadcast"):
    val live = game.copy(id = GameId("tvking02"))
    assertEquals(ThreeKingdomsTv.choose(Some(game), List(live), None), Some(live))
    assertEquals(ThreeKingdomsTv.choose(None, List(live), None), Some(live))
    assertEquals(ThreeKingdomsTv.choose(None, Nil, None), None)
