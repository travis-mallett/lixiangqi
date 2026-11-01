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
  val emptyAnalysis = Analysis(
    Analysis.Id(GameId("abcd")),
    Nil,
    Ply.initial,
    Xiangqi.Game.initial.position,
    nowInstant,
    None,
    None
  )

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

  private def exportPgn(result: String, tags: Boolean, moves: List[String] = List("P9+1", "c2=5")) =
    Pgn(
      if tags then Tags(List(Tag(_.Result, result))) else Tags.empty,
      InitialComments.empty,
      chess.Tree.build[String, chess.format.pgn.Move](
        moves,
        san => chess.format.pgn.Move(chess.format.pgn.SanStr(san))
      ),
      Ply.firstMove
    )

  for
    result <- List("1-0", "0-1", "1/2-1/2", "*")
    tags <- List(true, false)
  do
    test(s"export preserves $result with tags=$tags"):
      val pgn = exportPgn(result, tags)
      val header = if tags then s"[Result \"$result\"]\n\n" else ""
      assertEquals(annotator.toPgnString(pgn, result).value, s"${header}1. P9+1 c2=5 $result\n\n\n")
      if tags then assertEquals(annotator.toPgnString(pgn, result), annotator.toPgnString(pgn))

    test(s"export without moves preserves $result with tags=$tags"):
      val pgn = exportPgn(result, tags, Nil)
      val exported = annotator.toPgnString(pgn, result).value
      assertEquals(exported.trim.split("\\s+").last, result)
      assertEquals(exported.contains("[Result"), tags)

  for tags <- List(true, false) do
    test(s"multiple exported games retain separate results with tags=$tags"):
      val first = annotator.toPgnString(exportPgn("0-1", tags), "0-1").value
      val second = annotator.toPgnString(exportPgn("1/2-1/2", tags), "1/2-1/2").value
      val games = (first + second).split("\n\n\n").toList
      assertEquals(games.size, 2)
      assert(games.head.endsWith("1. P9+1 c2=5 0-1"))
      assert(games(1).endsWith("1. P9+1 c2=5 1/2-1/2"))
      assertEquals(games.forall(_.contains("[Result")), tags)
