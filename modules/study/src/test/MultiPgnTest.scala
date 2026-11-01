package lila.study

import chess.format.pgn.PgnStr

class MultiPgnTest extends munit.FunSuite:
  test("native chapter documents preserve all games and reject overflow"):
    val games = List("[Red \"A\"]\n\n1. a4a5 *", "[Red \"B\"]\n\n1. i1i2 *")
    assertEquals(MultiPgn.split(PgnStr(games.mkString("\n\n")), Max(10)).value.map(_.value), games)
    intercept[IllegalArgumentException](MultiPgn.split(PgnStr(games.mkString("\n\n")), Max(1)))
  test("empty input has no chapters"):
    assertEquals(MultiPgn.split(PgnStr(""), Max(10)).value, Nil)

  test("a malformed later header rejects the entire batch before chapter creation"):
    val first = "[Event \"First\"]\n1. a4a5 a7a6 *\n\n"
    val broken = "[ChapterDescription \"unfinished\n1. i4i5 i7i6 *\n\"]\n[Event \"Next\"]\n1. c4c5 c7c6 *"
    intercept[IllegalArgumentException](MultiPgn.split(PgnStr(first + broken), Max(10)))
