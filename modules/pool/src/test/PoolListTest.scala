package lila.pool

class PoolListTest extends munit.FunSuite:

  test("Manchu+ has an independent rated ten-minute room"):
    val pool = PoolList.manchu
    assertEquals(pool.id.value, "manchu-v1-ranked-10+0-m60-30x3")
    assertEquals(pool.gameVariant, lila.xiangqi.GameVariant.Manchu)
    assertEquals(pool.rankTrack, Some(lila.core.rank.RankTrackId.manchu))
    assertEquals(pool.clock.limitInMinutes, 10d)
    assertEquals(pool.clock.incrementSeconds.value, 0)
    assert(pool.ranked)
    assert(PoolList.homepage.contains(pool))
    assertEquals(PoolList.all.count(_.id == pool.id), 1)

  test("homepage pools have their exact bank and per-move controls"):
    val rooms = PoolList.homepage
      .filter(_.gameVariant == lila.xiangqi.GameVariant.Xiangqi)
      .map(pool => pool.clock.limitInMinutes -> pool)
      .toMap

    assertEquals(rooms.keySet, Set(5d, 10d, 15d, 20d))
    assertEquals(rooms.values.map(_.clock.incrementSeconds.value).toSet, Set(0))

    rooms.foreach: (minutes, pool) =>
      val limit = pool.moveTimeLimit.getOrElse(fail(s"$minutes minute room has no move limit"))
      assertEquals(limit.limitForMove(1), 30)
      assertEquals(limit.limitForMove(3), 30)
      assertEquals(limit.limitForMove(4), if minutes == 15d then 90 else 60)

    assertEquals(rooms(15d).id.value, "15+0-m90-30x3")
    assertEquals(rooms(5d).id.value, "5+0-m60-30x3")
    assertEquals(rooms(10d).id.value, "10+0-m60-30x3")
    assertEquals(rooms(20d).id.value, "20+0-m60-30x3")

  test("the original lobby pool list remains separate from homepage rooms"):
    assertEquals(PoolList.lobby.size, 11)
    assert(PoolList.lobby.exists(pool => pool.clock.show == "15+10"))
    assert(PoolList.lobby.forall(_.moveTimeLimit.isEmpty))
    assertEquals(PoolList.all, PoolList.lobby ::: PoolList.homepage.filterNot(_ == PoolList.threeKingdoms))

  test("only the 15-minute homepage room carries the Xiangqi rank track"):
    val ranked =
      PoolList.homepage.filter(pool => pool.ranked && pool.gameVariant == lila.xiangqi.GameVariant.Xiangqi)
    assertEquals(ranked.map(_.clock.limitInMinutes), List(15d))
    assertEquals(ranked.flatMap(_.rankTrack), List(lila.core.rank.RankTrackId.xiangqi))
    assert(PoolList.lobby.forall(pool => !pool.ranked))

  test("homepage room identities require an exact clock and move-time match"):
    val ids = PoolList.homepage.iterator.map(_.id).toSet

    assert(ids(PoolList.homepage.head.id))
    assert(!ids(PoolList.lobby.find(_.clock.show == "10+5").get.id))
    assert(!ids(PoolList.lobby.find(_.clock.show == "10+0").get.id))

  test("Jieqi uses the shared homepage matchmaking rooms with its own ranked controls"):
    val pool = PoolList.homepage.find(_.id == PoolList.jieqi.id).getOrElse(fail("Jieqi room missing"))
    assert(pool.ranked)
    assertEquals(pool.rankTrack, Some(lila.core.rank.RankTrackId.jieqi))
    assertEquals(pool.clock, lila.core.game.RankedGame.jieqiClock)
    assertEquals(pool.moveTimeLimit, Some(lila.core.game.RankedGame.jieqiMoveTime))
    assertEquals(PoolList.all.count(_.id == pool.id), 1)

  test("Mini Xiangqi has its own ranked room with the Jieqi time control"):
    val pool = PoolList.minixiangqi
    assert(!pool.acceptsLobbyHooks)
    assert(!PoolList.jieqi.acceptsLobbyHooks)
    assert(PoolList.lobby.forall(_.acceptsLobbyHooks))
    assertEquals(pool.id.value, "minixiangqi-v1-ranked-10+0-m60-30x3")
    assertEquals(pool.gameVariant, lila.xiangqi.GameVariant.MiniXiangqi)
    assertEquals(pool.rankTrack, Some(lila.core.rank.RankTrackId.minixiangqi))
    assertEquals(pool.clock, PoolList.jieqi.clock)
    assertEquals(pool.moveTimeLimit, PoolList.jieqi.moveTimeLimit)
    assertEquals(PoolList.all.count(_.id == pool.id), 1)

  test("Three Kingdoms uses the shared room catalog with three-seat pairing"):
    val pool = PoolList.threeKingdoms
    assertEquals(pool.id.value, "threeKingdoms-v1-ranked-15+0-m60")
    assertEquals(pool.gameVariant, lila.xiangqi.GameVariant.ThreeKingdoms)
    assertEquals(pool.clock.limitInMinutes, 15d)
    assertEquals(pool.moveTimeLimit.map(_.seconds), Some(60))
    assert(PoolList.homepage.contains(pool))
    assert(!PoolList.all.contains(pool))
