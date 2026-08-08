package lila.db

import lila.core.game.MoveTimeLimit

class MoveTimeLimitBsonTest extends munit.FunSuite:

  test("move-time configurations survive a BSON round trip"):
    val limit = MoveTimeLimit(
      seconds = 90,
      first = Some(MoveTimeLimit.FirstPhase(moves = 3, seconds = 30))
    )
    val encoded = BSON.moveTimeLimitHandler.writeTry(limit).get
    val decoded = BSON.moveTimeLimitHandler.readTry(encoded).get

    assertEquals(decoded, limit)

  test("incomplete opening-phase BSON is rejected"):
    val encoded = reactivemongo.api.bson.BSONDocument("s" -> 60, "m" -> 3)

    assert(BSON.moveTimeLimitHandler.readTry(encoded).isFailure)
