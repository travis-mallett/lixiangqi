package lila.study

import chess.format.pgn.PgnStr
import lila.tree.Node.{ Comment, Comments }

class LocalAnalysisTest extends munit.FunSuite:
  private def root = StudyPgnImport.result(PgnStr("1. i1i2 i10i9 *"), Nil).toOption.get.root
  private def data = LocalAnalysis.Data(
    root.fen.value,
    root.ruleset.key,
    List("i1i2", "i10i9"),
    List(
      LocalAnalysis.Evaluation(Some(20), None, 15, List("i1i2")),
      LocalAnalysis.Evaluation(Some(10), None, 16, List("i10i9")),
      LocalAnalysis.Evaluation(Some(15), None, 17, Nil)
    )
  )

  test("browser scores and depth survive native persistence and preserve annotations"):
    import reactivemongo.api.bson.*
    import BSONHandlers.given
    val original = root.copy(comments =
      Comments(
        List(Comment(Comment.Id("keep"), chess.format.pgn.Comment("Keep my comment"), Comment.Author.Unknown))
      )
    )
    val updated = LocalAnalysis.merge(original, data).toOption.get
    assertEquals(updated.comments, original.comments)
    assertEquals(updated.mainline.map(_.eval.get.cp.get.value), List(10, 15))
    assertEquals(updated.mainline.map(_.evaluationDepth), List(Some(16), Some(17)))
    val handler = summon[BSONHandler[lila.tree.Root]]
    assertEquals(handler.readTry(handler.writeTry(updated).get).get, updated)

  test("stale sources, partial batches and illegal principal variations are rejected atomically"):
    assert(LocalAnalysis.merge(root, data.copy(moves = List("a1a2"))).isLeft)
    assert(LocalAnalysis.merge(root, data.copy(ruleset = "wrong")).isLeft)
    assert(LocalAnalysis.merge(root, data.copy(evaluations = data.evaluations.tail)).isLeft)
    val illegal = data.evaluations.head.copy(variation = List("i1i10"))
    assert(LocalAnalysis.merge(root, data.copy(evaluations = illegal :: data.evaluations.tail)).isLeft)

  test("invalid scores cannot enter chapter storage"):
    val invalid = data.evaluations.head.copy(cp = Some(Int.MaxValue), mate = Some(1))
    assert(LocalAnalysis.merge(root, data.copy(evaluations = invalid :: data.evaluations.tail)).isLeft)
