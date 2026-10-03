package lila.playerDirectory

import java.time.YearMonth
import chess.rating.Elo

class DirectoryRatingHistoryTest extends munit.FunSuite:

  test("DirectoryRatingPoint.decode"):
    assertEquals(
      DirectoryRatingPoint(YearMonth.parse("2021-03"), Elo(1800)),
      DirectoryRatingPoint(2021031800)
    )
    assertEquals(DirectoryRatingPoint(YearMonth.parse("1991-12"), Elo(777)), DirectoryRatingPoint(1991120777))

  test("DirectoryRatingPoint.encode"):
    assertEquals(DirectoryRatingPoint(2021031800).date, YearMonth.parse("2021-03"))
    assertEquals(DirectoryRatingPoint(2021031800).elo, Elo(1800))
    assertEquals(DirectoryRatingPoint(1991120777).date, YearMonth.parse("1991-12"))
    assertEquals(DirectoryRatingPoint(1991120777).elo, Elo(777))
