package lila.pool

class PoolListTest extends munit.FunSuite:

  test("homepage pools have their exact bank and per-move controls"):
    val rooms = PoolList.homepage.map(pool => pool.clock.limitInMinutes -> pool).toMap

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
    assertEquals(PoolList.all, PoolList.lobby ::: PoolList.homepage)

  test("homepage room identities require an exact clock and move-time match"):
    val ids = PoolList.homepage.iterator.map(_.id).toSet

    assert(ids(PoolList.homepage.head.id))
    assert(!ids(PoolList.lobby.find(_.clock.show == "10+5").get.id))
    assert(!ids(PoolList.lobby.find(_.clock.show == "10+0").get.id))
