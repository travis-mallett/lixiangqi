package lila.study

import chess.{ ByColor, Ply }
import chess.eval.Eval.{ Cp, Mate }
import chess.format.{ Fen, UciPath }
import chess.format.pgn.{ Tags, Comment as CommentStr }
import play.api.libs.json.*

import lila.common.Json.given
import lila.tree.{ Analysis, Eval, Info }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

class ChapterAnalysisTest extends munit.FunSuite:
  given Executor = scala.concurrent.ExecutionContext.global

  private def game(
      moves: Vector[String] = Vector("a4a5", "a7a6"),
      fen: String = Xiangqi.startFen
  ): Game =
    val native = XiangqiRules.game(Xiangqi.Position(fen, moves.map(Xiangqi.Uci.unsafe))).toOption.get
    val game = lila.core.game
      .newGame(
        native,
        ByColor(lila.core.game.Player(lila.core.id.GamePlayerId("abcd"), _, aiLevel = None)),
        rated = chess.Rated.No,
        source = lila.core.game.Source.Api,
        pgnImport = None
      )
      .withId(GameId("source01"))
    game.copy(status = chess.Status.Resign, metadata = game.metadata.copy(analysed = true))

  private def chapter(game: Game): Chapter = Chapter
    .make(
      studyId = StudyId("study001"),
      name = StudyChapterName("Source game"),
      setup = Chapter.Setup(Some(game.id), game.variant, chess.Color.White),
      root = GameToRoot(game, None, withClocks = false),
      tags = Tags.empty,
      order = 1,
      ownerId = UserId("owner"),
      practice = false,
      gamebook = false,
      conceal = None
    )
    .copy(id = StudyChapterId("chapter1"))

  private def analysis(game: Game): Analysis = Analysis(
    id = Analysis.Id(game.id),
    infos = game.xiangqi.states.tail.toList.map: state =>
      Info(Ply(state.ply), Eval(Some(Cp(state.ply * 15)), None, None), Nil),
    startPly = Ply(game.xiangqi.states.head.ply),
    date = java.time.Instant.EPOCH,
    fk = None,
    nodesPerMove = None
  )

  private def resolver(game: Option[Game], analysis: Option[Analysis]) = ChapterAnalysis(
    _ => fuccess(game),
    _ => fuccess(analysis)
  )

  test("a linked published game resolves without changing the chapter"):
    val source = game()
    val imported = chapter(source)
    val saved = analysis(source)
    resolver(Some(source), Some(saved))(imported).map: result =>
      assertEquals(result.analysis, Some(saved))
      assertEquals(result.sourceGame, Some(source.id))
      assertEquals(imported.serverEval, None)
      assert(imported.root.mainline.forall(_.eval.isEmpty))

  test("the complete move sequence must match: truncation, extension, and another line are rejected"):
    val source = game()
    val alternatives = List(
      game(Vector("a4a5")),
      game(Vector("a4a5", "a7a6", "c4c5")),
      game(Vector("c4c5", "a7a6"))
    )
    val resolve = ChapterAnalysis(
      _ => fuccess(Some(source)),
      _ => fail("A mismatched game must not query analysis")
    )
    Future.traverse(alternatives): changed =>
      resolve(chapter(changed)).map: result =>
        assertEquals(result, ChapterAnalysis.Result(None))

  test("a changed starting FEN, ply offset, or variant cannot inherit source analysis"):
    val source = game()
    val imported = chapter(source)
    val changes = List(
      imported.copy(root = imported.root.copy(fen = Fen.Full(Xiangqi.startFen.replace("0 1", "1 1")))),
      imported.copy(root = imported.root.copy(ply = Ply(2))),
      imported.copy(setup = imported.setup.copy(variant = chess.variant.FromPosition))
    )
    Future.traverse(changes): changed =>
      resolver(Some(source), Some(analysis(source)))(changed).map: result =>
        assertEquals(result, ChapterAnalysis.Result(None))

  test("an unlinked chapter does not look up a game or an analysis"):
    val imported = chapter(game())
    ChapterAnalysis(_ => fail("No game lookup"), _ => fail("No analysis lookup"))(
      imported.copy(setup = imported.setup.copy(gameId = None))
    ).map(result => assertEquals(result, ChapterAnalysis.Result(None)))

  test("deleted, unpublished, and missing analyses produce no inherited state"):
    val source = game()
    val imported = chapter(source)
    val unpublished = source.copy(metadata = source.metadata.copy(analysed = false))
    val cases = List(
      None -> Some(analysis(source)),
      Some(unpublished) -> Some(analysis(source)),
      Some(source) -> None
    )
    Future.traverse(cases): (stored, saved) =>
      resolver(stored, saved)(imported).map: result =>
        assertEquals(result, ChapterAnalysis.Result(None))

  test("an active source is never exposed even if it has a published analysis flag"):
    val source = game().copy(status = chess.Status.Started)
    ChapterAnalysis(
      _ => fuccess(Some(source)),
      _ => fail("An active game must not query its analysis")
    )(chapter(source)).map: result =>
      assertEquals(result, ChapterAnalysis.Result(None))

  test("published analysis must belong to the game and cover the exact chapter plies"):
    val source = game()
    val saved = analysis(source)
    val invalid = List(
      saved.copy(id = Analysis.Id(GameId("other001"))),
      saved.copy(startPly = Ply(1)),
      saved.copy(infos = saved.infos.tail),
      saved.copy(infos = saved.infos.reverse),
      saved.copy(infos = Nil)
    )
    Future.traverse(invalid): changed =>
      resolver(Some(source), Some(changed))(chapter(source)).map: result =>
        assertEquals(result, ChapterAnalysis.Result(None))

  test("a nonstandard Black-to-move source preserves absolute plies and score perspective"):
    val first = game(Vector("a4a5"))
    val fen = first.xiangqi.state.fen.split(' ').updated(5, "17").mkString(" ")
    val source = game(Vector("a7a6"), fen)
    val imported = chapter(source)
    val saved = analysis(source)
    resolver(Some(source), Some(saved))(imported).map: result =>
      assertEquals(result.sourceGame, Some(source.id))
      assertEquals(result.analysis.map(_.startPly), Some(Ply(33)))
      val node = JsonView.analysisTree(imported, result, lichobile = false).as[JsArray].value(1)
      assertEquals((node \ "ply").as[Int], 34)
      assertEquals((node \ "eval" \ "cp").as[Int], saved.infos.head.cp.get.value)

  test("an existing chapter analysis is canonical regardless of its pending marker or source edits"):
    val source = game()
    val edited = chapter(game(Vector("c4c5"))).copy(serverEval = Some(Chapter.ServerEval(UciPath.root, true)))
    val saved = analysis(source).copy(id = Analysis.Id(edited.studyId, edited.id))
    Future.traverse(List(false, true)): done =>
      ChapterAnalysis(
        _ => fail("Chapter analysis must not look up the source"),
        id =>
          assertEquals(id, saved.id)
          fuccess(Some(saved))
      )(edited.copy(serverEval = Some(Chapter.ServerEval(UciPath.root, done)))).map: result =>
        assertEquals(result.analysis, Some(saved))
        assertEquals(result.sourceGame, None)

  test("pending requests and completed markers without documents fall back to exact source analysis"):
    val source = game()
    val imported = chapter(source)
    val saved = analysis(source)
    Future.traverse(List(false, true)): done =>
      val marker = Chapter.ServerEval(imported.root.mainlinePath, done)
      val own = imported.copy(serverEval = Some(marker))
      ChapterAnalysis(
        _ => fuccess(Some(source)),
        id => fuccess(Option.when(id == saved.id)(saved))
      )(own).map: result =>
        assertEquals(result, ChapterAnalysis.Result(Some(saved), Some(source.id)))
        assertEquals(own.serverEval, Some(marker))
        assertEquals(JsonView.chapterServerEval(own, result).map(js => (js \ "done").as[Boolean]), Some(true))

  test("a pending marker survives when an edited chapter cannot inherit the source"):
    val source = game()
    val marker = Chapter.ServerEval(chapter(source).root.mainlinePath, false)
    val edited = chapter(game(Vector("c4c5"))).copy(serverEval = Some(marker))
    resolver(Some(source), None)(edited).map: result =>
      assertEquals(result, ChapterAnalysis.Result(None))
      assertEquals(
        JsonView.chapterServerEval(edited, result),
        Some(Json.obj("done" -> false, "path" -> marker.path))
      )

  test("the read-time overlay preserves chapter evaluations, comments, variations, and mate zero"):
    val source = game()
    val imported = chapter(source)
    val originalScore = Eval(Some(Cp(999)), None, None)
    val comment = lila.tree.Node.Comment(
      lila.tree.Node.Comment.Id("note"),
      CommentStr("Keep this annotation"),
      lila.tree.Node.Comment.Author.External("Coach")
    )
    val first = imported.root.children.first.get.copy(
      eval = Some(originalScore),
      comments = lila.tree.Node.Comments(List(comment))
    )
    val variation = chapter(game(Vector("c4c5"))).root.children.first.get
    val annotated =
      imported.copy(root = imported.root.copy(children = lila.tree.Branches(List(first, variation))))
    val saved = analysis(source)
    val mate =
      saved.copy(infos = saved.infos.init :+ saved.infos.last.copy(eval = Eval(None, Some(Mate(0)), None)))
    val resolved = ChapterAnalysis.Result(Some(mate), Some(source.id))
    List(false, true).foreach: mobile =>
      val tree = JsonView.analysisTree(annotated, resolved, lichobile = mobile).as[JsArray].value
      assertEquals((tree.head \ "eval").toOption, None)
      assertEquals((tree(1) \ "eval" \ "cp").as[Int], 999)
      assertEquals((tree(1) \ "eval" \ "sourceGame").toOption, None)
      val commentJson = (tree(1) \ "comments").as[JsArray].value.head
      assertEquals((commentJson \ "text").as[String], comment.text.value)
      assertEquals((tree(2) \ "eval" \ "mate").as[Int], 0)
      assertEquals((tree(2) \ "eval" \ "sourceGame").as[Boolean], true)
      val variations = (tree.head \ "children").as[JsArray].value
      assertEquals(variations.size, 1)
      assertEquals((variations.head \ "eval").toOption, None)
    assertEquals(annotated.root.children.first.get.eval, Some(originalScore))
    assertEquals(annotated.root.mainline.last.eval, None)
    assertEquals(
      JsonView.chapterServerEval(annotated, resolved),
      Some(Json.obj("done" -> true, "path" -> annotated.root.mainlinePath, "sourceGame" -> source.id))
    )

  test("chapter analysis uses the original tree and server-evaluation metadata"):
    val imported = chapter(game()).copy(serverEval = Some(Chapter.ServerEval(UciPath.root, true)))
    val resolved = ChapterAnalysis.Result(Some(analysis(game())))
    assertEquals(
      JsonView.analysisTree(imported, resolved, lichobile = false),
      lila.tree.Node.partitionTreeWriter(imported.root, lichobile = false)
    )
    assertEquals(
      JsonView.chapterServerEval(imported, resolved),
      Some(Json.obj("done" -> true, "path" -> UciPath.root))
    )

  test("a legacy study import that lost a rank ten move cannot inherit scores for different positions"):
    val source = game(Vector("a4a5", "b10c8"))
    resolver(Some(source), Some(analysis(source)))(chapter(source)).map: result =>
      assertEquals(result, ChapterAnalysis.Result(None))
