package lila.relay

import chess.format.pgn.PgnStr
import chess.Centis
import lila.study.{ MultiPgn, StudyPgnTags }
import lila.tree.Clock

class RelayGameTest extends munit.FunSuite:

  def makeGame(pgn: String) =
    RelayFetch.multiPgnToGames
      .either(MultiPgn(List(PgnStr(pgn))))
      .fold(error => fail(error.getMessage), identity)
      .head

  val g1 = makeGame:
    """
[Red "Khusenkhojaev, Mustafokhuja"]
[Black "Lam, Chun Yung Samuel"]
[RedClock "00:33:51"]
[BlackClock "01:23:54"]
[ReferenceTime "B/2024-12-19T17:52:47.862Z"]

1. a4a5 h10g8
"""

  val redCentis = Centis.ofSeconds(33 * 60 + 51)
  val blackCentis = Centis.ofSeconds(1 * 3600 + 23 * 60 + 54)

  test("parse clock tags"):
    assertEquals(StudyPgnTags.clocks(g1.tags).red, redCentis.some)
    assertEquals(StudyPgnTags.clocks(g1.tags).black, blackCentis.some)

  test("applyTagClocksToLastMoves"):
    val applied = g1.applyTagClocksToLastMoves
    assertEquals(applied.root.lastMainlineNode.clock, Clock(blackCentis, true.some).some)
    assertEquals(applied.root.mainline.head.clock, Clock(redCentis, true.some).some)

  val g2 = makeGame:
    """
[Red "General Red"]
[RedClock "00:00:23"]
[BlackClock "00:00:41"]
"""

  test("parse native Xiangqi participant tags"):
    assertEquals(StudyPgnTags.names(g2.tags).red.map(_.value), "General Red".some)
    assertEquals(StudyPgnTags.clocks(g2.tags).red, Centis.ofSeconds(23).some)
    assertEquals(StudyPgnTags.clocks(g2.tags).black, Centis.ofSeconds(41).some)

  val (g3, g4, g5, g6, g7, g8) = (
    makeGame("1. e4e5 e7e6"),
    makeGame("1. a4a5 a7a6"),
    makeGame("1. c4c5 c7c6"),
    makeGame("1. h1g3 h10g8"),
    makeGame("1. e4e5"),
    makeGame("1. a4a5")
  )
  val all = Vector(g1, g2, g3, g4, g5, g6, g7, g8)
  import RelayGame.Slices
  def slice(str: String) = Slices.filterAndOrder(Slices.parse(str))(all)

  test("slices filter games"):
    assertEquals(slice("1-3"), Vector(g1, g2, g3))
    assertEquals(slice("4"), Vector(g4))
    assertEquals(slice("2-3,7,8"), Vector(g2, g3, g7, g8))

  test("slices order games"):
    assertEquals(slice("7,8,2-3"), Vector(g7, g8, g2, g3))
    assertEquals(slice("3,2-4"), Vector(g3, g2, g4))
    assertEquals(slice("3,2-4,1-3"), Vector(g3, g2, g4, g1))

  test("delay serialization retains rank ten, variations, comments and annotations"):
    val original = makeGame("""[Red "Red player"]
[Black "Black player"]
[Event "Native broadcast"]

{root comment} 1. i4i5 $1 {[%csl Gi10] [%cal Ri10i9] [%clk 0:03:01.25]}
(1. a4a5 {alternative} a7a6) i10i9 {live comment} *
""")
    val encoded = RelayGame.iso.from(Vector(original))
    val decoded = RelayGame.iso.to(encoded).head
    assertEquals(decoded.root.mainline.map(_.move.uci), original.root.mainline.map(_.move.uci))
    assertEquals(decoded.root.children.toList.size, original.root.children.toList.size)
    assertEquals(decoded.root.comments.value.map(_.text), original.root.comments.value.map(_.text))
    assertEquals(decoded.root.mainline.head.shapes, original.root.mainline.head.shapes)
    assertEquals(decoded.root.mainline.head.clock, original.root.mainline.head.clock)
    assertEquals(decoded.root.mainline.head.glyphs, original.root.mainline.head.glyphs)
    assertEquals(decoded.tags("Red"), Some("Red player"))

  test("illegal native variations produce explicit import errors"):
    val result = RelayFetch.multiPgnToGames.either(MultiPgn(List(PgnStr("1. a4a5 (1. i1a10) a7a6"))))
    assert(result.isLeft)

  test("participant scores retain double forfeits"):
    val game = makeGame("""[Red "Red player"]
[Black "Black player"]
[Result "0-0"]

0-0""")
    assertEquals(game.showResult, "0-0")

  test("single-character native player names and source dates are preserved"):
    val game = makeGame("""[Red "棋"]
[Black "王"]
[Date "2026.09.29"]

1. a4a5 a7a6 *""")
    assertEquals(game.tags("Red"), Some("棋"))
    assertEquals(game.tags("Black"), Some("王"))
    assertEquals(game.tags("Date"), Some("2026.09.29"))
