package lila.study

import chess.format.pgn.PgnStr

class MultiPgnTest extends munit.FunSuite:
  test("native chapter documents preserve all games and reject overflow"):
    val games = List("[Red \"A\"]\n\n1. a4a5 *", "[Red \"B\"]\n\n1. i1i2 *")
    assertEquals(MultiPgn.split(PgnStr(games.mkString("\n\n")), Max(10)).value.map(_.value), games)
    intercept[IllegalArgumentException](MultiPgn.split(PgnStr(games.mkString("\n\n")), Max(1)))
  test("empty input has no chapters"):
    assertEquals(MultiPgn.split(PgnStr(""), Max(10)).value, Nil)
