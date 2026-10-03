package lila.study

import chess.eval.Eval.{ Cp, Mate }
import play.api.libs.json.*
import lila.tree.{ Advice, Branch, Branches, Eval, Info, Root }
import lila.xiangqi.{ UciPath, Xiangqi, XiangqiRules }
import lila.xiangqi.XiangqiGlyph.{ Glyph, Glyphs }

/** Contributor-supplied browser evaluations are chapter annotations, never trusted cloud analysis. */
object LocalAnalysis:
  case class Evaluation(cp: Option[Int], mate: Option[Int], depth: Int, variation: List[String]):
    def score = Eval(cp.map(Cp(_)), mate.map(Mate(_)), None)
  case class Data(initialFen: String, ruleset: String, moves: List[String], evaluations: List[Evaluation])
  given Reads[Evaluation] = Json.reads[Evaluation]
  given Reads[Data] = Json.reads[Data]

  def merge(root: Root, data: Data): Either[String, Root] = scala.util
    .Try {
      val mainline = root.mainline
      require(
        data.initialFen == root.fen.value && data.ruleset == root.ruleset.key,
        "Chapter position changed"
      )
      require(data.moves == mainline.map(_.id.value), "Chapter mainline changed")
      require(data.evaluations.size == mainline.size + 1, "Incomplete chapter analysis")
      require(data.evaluations.size <= UciPath.maxDepth + 1, "Analysis is too large")
      data.evaluations.foreach { e =>
        require(e.cp.isDefined != e.mate.isDefined, "Expected one evaluation score")
        require(e.cp.forall(n => n >= -100000 && n <= 100000), "Invalid centipawn score")
        require(e.mate.forall(n => n >= -1000 && n <= 1000), "Invalid mate score")
        require(e.depth >= 0 && e.depth <= 128 && e.variation.size <= 12, "Invalid analysis depth")
      }
      // Validate the complete batch before writing anything, against the current native history.
      var path = UciPath.root
      val variations = data.evaluations.zipWithIndex.map { (evaluation, index) =>
        val game = root.gameAt(path).fold(error => throw IllegalArgumentException(error), identity)
        val moves = evaluation.variation.map(s =>
          Xiangqi.Uci.from(s).fold(error => throw IllegalArgumentException(error), identity)
        )
        val line = XiangqiRules
          .variation(game, moves.toVector)
          .fold(error => throw IllegalArgumentException(error), identity)
        if index < mainline.size then path = path + mainline(index).id
        line.moves.foldRight(Option.empty[Branch]) { (move, child) =>
          Some(
            Branch(
              move.state,
              Xiangqi.Move(move.move, move.notation, move.chineseNotation),
              children = Branches(child.toList),
              comp = true
            )
          )
        }
      }
      val first = data.evaluations.head
      var updated = root.copy(eval = Some(first.score), evaluationDepth = Some(first.depth))
      path = UciPath.root
      mainline.zipWithIndex.foreach { (node, index) =>
        val prev = data.evaluations(index)
        val next = data.evaluations(index + 1)
        val best = prev.variation.map(s => Xiangqi.Uci.from(s).toOption.get)
        val advice = Option
          .when(best.headOption.exists(_ != node.id))(
            Advice(Info(node.ply - 1, prev.score, Nil), Info(node.ply, next.score, best))
          )
          .flatten
        if advice.isDefined then
          variations(index).foreach { branch =>
            updated = updated.withChildren(_.addNodeAt(branch, path)).get
          }
        path = path + node.id
        updated = updated
          .withChildren(
            _.updateAt(
              path,
              current =>
                current.copy(
                  eval = Some(next.score),
                  evaluationDepth = Some(next.depth),
                  glyphs = if current.glyphs.toList.isEmpty then
                    advice.fold(current.glyphs)(a => Glyphs.fromList(List(Glyph.fromId(a.judgment.glyph.id))))
                  else current.glyphs
                )
            )
          )
          .get
      }
      require(updated.children.countRecursive <= Chapter.maxNodes, "Analysis exceeds chapter node limit")
      require(updated.children.maxDepth <= UciPath.maxDepth, "Analysis exceeds chapter depth limit")
      updated
    }
    .toEither
    .left
    .map(_.getMessage)
