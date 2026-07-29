package lila.analyse
import chess.format.pgn.{ InitialComments, Pgn, Tag, Tags }
import chess.{ ByColor, Ply }

import lila.core.config.NetDomain
import lila.core.id.GamePlayerId
import lila.xiangqi.Xiangqi

class AnnotatorTest extends munit.FunSuite:

  given Executor = scala.concurrent.ExecutionContextOpportunistic

  val annotator = Annotator(NetDomain("l.org"))
  def makeGame =
    lila.core.game
      .newGame(
        Xiangqi.Game.initial,
        ByColor(lila.core.game.Player(GamePlayerId("abcd"), _, aiLevel = none)),
        rated = chess.Rated.No,
        source = lila.core.game.Source.Api,
        pgnImport = none
      )
      .sloppy
  val emptyPgn = Pgn(Tags.empty, InitialComments.empty, None, Ply.initial)
  def withAnnotator(pgn: Pgn) = pgn.copy(tags = pgn.tags + Tag(name = "Annotator", value = "l.org"))
  val emptyAnalysis = Analysis(Analysis.Id(GameId("abcd")), Nil, Ply.initial, nowInstant, None, None)

  test("empty game"):
    assertEquals(
      annotator(emptyPgn, makeGame, none),
      withAnnotator(emptyPgn)
    )

  test("empty analysis"):
    assertEquals(
      annotator(emptyPgn, makeGame, emptyAnalysis.some),
      withAnnotator(emptyPgn)
    )
