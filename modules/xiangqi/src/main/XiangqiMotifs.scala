package lila.xiangqi

import scala.collection.mutable
import Xiangqi.*

/** Static tactical explanations share the native attack geometry and legal move generator. */
object XiangqiMotifs:
  final case class Pin(pinned: String, pinner: String, target: String)
  final case class Undefended(square: String, materialLoss: Int, principalAttacker: String)
  final case class Checkable(general: String, move: Uci)
  final case class Motifs(pins: Vector[Pin], undefended: Vector[Undefended], checkable: Vector[Checkable])

  def apply(position: Position): Either[String, Motifs] =
    XiangqiEvaluation
      .game(position)
      .flatMap: game =>
        scala.util.Try(compute(game)).toEither.left.map(_.getMessage)

  private def compute(game: Game): Motifs =
    val board = Fen.board(game.state.fen).get
    def value(piece: Piece): Int = if piece.role == Role.General then 1000 else piece.role.material
    def allowed(move: Uci, side: Side): Boolean =
      side != game.state.turn || game.state.legalMoves.contains(move)
    val pins = board.pieces.toVector.flatMap: (pinned, piece) =>
      if piece.role == Role.General then Vector.empty
      else
        val removed = board.copy(pieces = board.pieces - pinned)
        board.pieces.toVector.flatMap: (pinner, attacker) =>
          if attacker.side == piece.side then Vector.empty
          else
            val original = XiangqiRules.attackTargets(board, pinner).toSet
            XiangqiRules
              .attackTargets(removed, pinner)
              .filterNot(original)
              .flatMap: target =>
                board
                  .pieceAt(target)
                  .filter: protectedPiece =>
                    protectedPiece.side == piece.side &&
                      (protectedPiece.role == Role.General || value(protectedPiece) > value(piece) && value(
                        protectedPiece
                      ) > value(attacker))
                  .map(_ => Pin(pinned.key, pinner.key, target.key))

    val memo = mutable.Map.empty[(Board, Square, Side), (Int, Option[Uci])]
    val initialBoard = board
    var searched = 0
    def exchange(board: Board, target: Square, side: Side): (Int, Option[Uci]) =
      memo.getOrElseUpdate(
        (board, target, side), {
          searched += 1
          if searched > 4096 then
            throw IllegalArgumentException("Tactical motif search exceeds the resource limit")
          val captured = board.pieceAt(target).filter(_.role != Role.General)
          captured.fold(0 -> Option.empty[Uci]): victim =>
            XiangqiRules
              .captures(board, side)
              .filter(_.dest == target.key)
              .filter(move => board != initialBoard || allowed(move, side))
              .sortBy(m => value(board.pieceAt(m.orig).get))
              .take(2)
              .foldLeft(0 -> Option.empty[Uci]): (best, move) =>
                val next = XiangqiRules.movedBoard(board, move)
                val gain = value(victim) - exchange(next, target, !side)._1
                if gain > best._1 then gain -> Some(move) else best
        }
      )
    val undefended = board.pieces.toVector.flatMap: (square, piece) =>
      if piece.role == Role.General then None
      else
        val (loss, move) = exchange(board, square, !piece.side)
        move
          .filter(allowed(_, !piece.side))
          .filter(_ => loss > 0)
          .map(m => Undefended(square.key, loss, m.orig))
    val checkable = (if game.state.ended then Vector.empty else Side.values.toVector).flatMap: side =>
      if XiangqiRules.isChecked(board, side) then None
      else
        for
          general <- board.pieces.collectFirst { case (square, Piece(`side`, Role.General)) => square }
          move <- XiangqiRules
            .boardMoves(board, !side)
            .find: move =>
              allowed(move, !side) && XiangqiRules.isChecked(XiangqiRules.movedBoard(board, move), side)
        yield Checkable(general.key, move)
    Motifs(pins.distinct, undefended, checkable)
