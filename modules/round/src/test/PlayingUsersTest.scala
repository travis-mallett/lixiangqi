package lila.round

class PlayingUsersTest extends munit.FunSuite:
  test("elimination clears that game without hiding another active game"):
    given Executor = scala.concurrent.ExecutionContext.global
    val playing = PlayingUsers()
    val first = GameId("first123")
    val second = GameId("second12")
    val users = List(UserId("alice"), UserId("bob"), UserId("carol"))
    playing.update(first, users, users.toSet)
    playing.update(second, List(users.head), Set(users.head))
    playing.update(first, users, Set(users(1)))
    assert(playing(users.head))
    assert(playing(users(1)))
    assert(!playing(users(2)))
    playing.update(second, List(users.head), Set.empty)
    assert(!playing(users.head))
    playing.update(first, users, Set.empty)
    assert(!playing(users(1)))
