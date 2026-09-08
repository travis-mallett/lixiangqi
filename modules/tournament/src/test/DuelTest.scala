package lila.tournament

import lila.core.chess.Rank
import lila.rating.XiangqiRank

class DuelTest extends munit.FunSuite:

  val store = new DuelStore
  val tourId = TourId("tour")
  val p1 = Duel.DuelPlayer(UserName("p1"), XiangqiRank.initialSnapshot, Rank(1))
  val p2 = Duel.DuelPlayer(UserName("p2"), XiangqiRank.initialSnapshot, Rank(2))

  test("duel store"):
    assertEquals(store.get(tourId), None)

    val duel1 = Duel(GameId("game1"), p1, p2, 0)

    store.add(tourId, duel1)
    assertEquals(store.get(tourId).map(_.toList), Some(List(duel1)))

    store.remove(GameId("game1"), tourId)
    assertEquals(store.get(tourId), None)
