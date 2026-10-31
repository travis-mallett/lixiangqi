package lila.core.pool

import lila.core.id.GameId
import lila.core.userId.UserId

class PoolParticipationTest extends munit.FunSuite:
  test("changing pools invalidates a previously selected group before game creation"):
    val gate = new PoolParticipation
    val users = List("a", "b", "c").map(UserId(_))
    users.foreach(u => assert(gate.join(u, "threeKingdoms", 0)))
    assert(gate.join(users.head, "15+0", 1))
    assert(!gate.reserve("threeKingdoms", users, GameId("three123"), 2))
    assert(gate.reserve("15+0", List(users.head), GameId("duel1234"), 2))
    assert(!gate.join(users.head, "threeKingdoms", 3))
    gate.release(GameId("three123"), users)
    assert(!gate.join(users.head, "threeKingdoms", 4))
    gate.release(GameId("duel1234"), users)
    assert(gate.join(users.head, "threeKingdoms", 5))

  test("only lobby hook candidates can be reserved without joining a pool"):
    val gate = new PoolParticipation
    val user = UserId("hook")
    assert(!gate.reserve("room", List(user), GameId("hook1234"), 0))
    assert(gate.reserve("room", List(user), GameId("hook1234"), 0, Set(user)))
