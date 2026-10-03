package lila.tree

import lila.xiangqi.XiangqiGlyph.{ Glyph, Glyphs }

import chess.format.Fen
import chess.format.pgn.Comment
import chess.{ Centis, Ply }
import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.Xiangqi.Move

object TreeBuilder:
  type LogRuleError = String => Unit
  private[tree] def makeEval(info: Info) = info.eval

  def apply(
      game: Game,
      analysis: Option[Analysis],
      initialFen: Fen.Full,
      withFlags: ExportOptions,
      logRuleError: LogRuleError
  ): Root =
    require(initialFen.value == game.xiangqi.initialFen, "Game tree initial position mismatch")
    val native = game.xiangqi
    val infos = analysis.toList.flatMap(_.infos).map(i => i.ply -> i).toMap
    val advice = analysis.toList.flatMap(_.advices).map(a => a.ply -> a).toMap
    val clocks = withFlags.clocks.so(game.bothClockStates).getOrElse(Vector.empty)
    val children = native.moves.zipWithIndex.foldRight(Branches.empty):
      case ((uci, index), next) =>
        val state = native.states(index + 1)
        val ply = Ply(state.ply)
        val branch = Branch(
          state,
          Move(uci, native.wxf(index), native.chineseWxf(index)),
          children = next,
          clock = clocks.lift(index).map(Clock(_)),
          eval = infos.get(ply).map(_.eval),
          glyphs = Glyphs.fromList(advice.get(ply).map(a => Glyph.fromId(a.judgment.glyph.id)).toList),
          comments = Node.Comments(
            game.drawOffers
              .normalizedPlies(ply)
              .option(makeSiteComment(Comment(s"${(!state.turn).key} offers a draw")))
              .toList :::
              advice.get(ply).map(a => makeSiteComment(a.makeComment(false))).toList
          )
        )
        val annotated = advice.get(ply + 1).fold(branch) { nextAdvice =>
          val history = native.copy(
            moves = native.moves.take(index + 1),
            wxf = native.wxf.take(index + 1),
            states = native.states.take(index + 2)
          )
          XiangqiRules
            .variation(history, nextAdvice.info.variation.toVector)
            .fold(
              error =>
                logRuleError(error);
                branch
              ,
              line =>
                line.moves
                  .foldRight(Option.empty[Branch])((step, child) =>
                    Some(
                      Branch(
                        step.state,
                        Move(step.move, step.notation, step.chineseNotation),
                        children = Branches(child.toList),
                        comp = true
                      )
                    )
                  )
                  .fold(branch)(branch.addChild)
            )
        }
        Branches(List(annotated))
    Root(
      native.states.head,
      native.ruleset,
      children = children,
      clock = withFlags.clocks.so(game.clock.map(c => Clock(Centis.ofSeconds(c.limitSeconds.value))))
    )

  private[tree] def makeSiteComment(c: Comment) =
    Node.Comment(Node.Comment.Id.make, c, Node.Comment.Author.Site)
