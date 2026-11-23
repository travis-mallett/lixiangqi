package lila.tournament

class CompetitionRankingTest extends munit.FunSuite:
  test("exact ties share places and consume positions"):
    val rank = new CompetitionRanking()
    assertEquals(
      List(800002, 800002, 400001, 200002, 200002, 0).map(rank.next(_).value),
      List(1, 1, 3, 4, 4, 6)
    )

  test("a tie spanning a page keeps its original place"):
    val rank = new CompetitionRanking(offset = 10, firstPlace = 8)
    assertEquals(List(22, 22, 21).map(rank.next(_).value), List(8, 8, 13))
