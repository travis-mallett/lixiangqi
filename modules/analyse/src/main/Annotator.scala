package lila.analyse

import chess.format.pgn.{ Comment, Glyphs, Move, Pgn, PgnStr, SanStr, Tag }
import chess.{ Ply, Tree, Variation }

import lila.core.game.{ Game, GameDrawOffers }
import lila.tree.{ Advice, Analysis, StatusText }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

final class Annotator(netDomain: lila.core.config.NetDomain) extends lila.tree.Annotator:

  def apply(p: Pgn, game: Game, analysis: Option[Analysis]): Pgn =
    annotateStatus(game):
      annotateTurns(
        annotateDrawOffers(p, game.drawOffers),
        analysis.so(_.advices),
        game
      ).copy(
        tags = p.tags + Tag(_.Annotator, netDomain)
      )

  def addEvals(p: Pgn, analysis: Analysis): Pgn =
    lila.mon.Chronometer.syncMon(lila.mon.analyse.annotator.addEvalsTime):
      analysis.infos.foldLeft(p): (pgn, info) =>
        pgn
          .updatePly(
            info.ply,
            move => move.copy(comments = info.pgnComment.toList ::: move.comments)
          )
          .getOrElse(pgn)

  // merge analysis & eval comments
  // 1. C2=5 { [%eval 0.17] } { [%clk 0:00:30] }
  // 1. C2=5 { [%eval 0.17] [%clk 0:00:30] }
  def toPgnString(pgn: Pgn): PgnStr = PgnStr:
    s"${pgn.render}\n\n\n".replaceIf("] } { [", "] [")

  private def annotateStatus(game: Game)(p: Pgn) =
    StatusText(
      game.status,
      game.winnerColor.map(c => if c.white then Xiangqi.Side.Red else Xiangqi.Side.Black),
      game.xiangqi.state
    ) match
      case "" => p
      case text => p.updateLastPly(_.copy(result = text.some))

  // add advices into mainline
  private def annotateTurns(p: Pgn, advices: List[Advice], game: Game): Pgn =
    advices
      .foldLeft(p): (pgn, advice) =>
        pgn
          .modifyInMainline(
            advice.ply,
            node =>
              node.copy(
                value = node.value.copy(
                  glyphs = Glyphs.fromList(advice.judgment.glyph :: Nil),
                  comments = advice.makeComment(true) :: node.value.comments
                ),
                variations = makeVariation(advice, game).toList ++ node.variations
              )
          )
          .getOrElse(pgn)

  private def annotateDrawOffers(pgn: Pgn, drawOffers: GameDrawOffers): Pgn =
    if drawOffers.isEmpty then pgn
    else
      drawOffers.normalizedPlies.foldLeft(pgn): (pgn, ply) =>
        pgn
          .updatePly(
            ply,
            move =>
              move.copy(comments =
                Comment(s"${if ply.value % 2 == 1 then "Red" else "Black"} offers draw") :: move.comments
              )
          )
          .getOrElse(pgn)

  private def makeVariation(advice: Advice, game: Game): Option[Variation[Move]] =
    val native = game.xiangqi
    val index = advice.ply.value - native.states.head.ply - 1
    require(index >= 0 && index < native.states.size, "Analysis variation starts outside its game")
    val before = native.copy(
      moves = native.moves.take(index),
      wxf = native.wxf.take(index),
      states = native.states.take(index + 1)
    )
    val rendered = advice.info.variation
      .take(20)
      .foldLeft(before -> List.empty[SanStr]):
        case ((position, notation), move) =>
          val next = XiangqiRules
            .move(position, move)
            .fold(
              error => throw IllegalArgumentException(s"Invalid analysis variation: $error"),
              identity
            )
          position
            .applyMove(next)
            .fold(
              error => throw IllegalArgumentException(error),
              _ -> (notation :+ SanStr(next.notation))
            )
    Tree.build[SanStr, Move](rendered._2, Move(_)).map(_.toVariation)
