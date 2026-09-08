package lila.xiangqi.adjudication

import lila.xiangqi.Xiangqi.*
import lila.xiangqi.XiangqiRules

/** Tiantian-specific threat classification; these facts are not national/WXF rule definitions. */
private[adjudication] object TiantianThreats:

  /** Reused across candidate continuations: the old board's threats are computed at most once. */
  final class Position(before: Board, previous: AdjudicationState, side: Side):
    private lazy val oldThreats = chaseThreats(before, side)
      .map(u => previous.identities(u.orig) -> previous.identities(u.dest))
      .toSet

    def classify(after: Board, move: MoveResult): MoveFact =
      val movedId = previous.identities(move.move.orig)
      val ids = (previous.identities - move.move.orig - move.move.dest) + (move.move.dest -> movedId)
      val checkers = XiangqiRules.checkingPieces(after, side).flatMap(ids.get).distinct.sorted
      val threats =
        if checkers.nonEmpty || move.capture then Vector.empty
        else
          chaseThreats(after, side)
            .map(u => ids(u.orig) -> ids(u.dest))
            .filterNot(oldThreats)
      MoveFact(
        side = side,
        piece = movedId,
        checkers = checkers,
        chasers = threats.map(_._1).distinct.sorted,
        targets = threats.map(_._2).distinct.sorted,
        capture = move.capture,
        responding = previous.fact.exists(_.forcing) || XiangqiRules.checkingPieces(before, !side).nonEmpty
      )

  /** A newly created legal capture threat. General/soldier attackers, uncrossed pawns and exchanges are
    * exempt. A protected target is exempt except a rook attacked by a horse/cannon. Recapture protection is
    * tested on the resulting board, respecting pins and cannon screens.
    */
  private def chaseThreats(board: Board, side: Side): Vector[Uci] =
    lazy val replies = XiangqiRules.captures(board, !side).toSet
    XiangqiRules
      .captures(board, side)
      .filter: uci =>
        val attacker = board.pieceAt(uci.orig).get
        val target = board.pieceAt(uci.dest).get
        val targetSquare = Square.fromKey(uci.dest).get
        val attackerSquare = Square.fromKey(uci.orig).get
        val uncrossedPawn = target.role == Role.Soldier &&
          (if target.side == Side.Red then targetSquare.rank <= 5 else targetSquare.rank >= 6)
        if attacker.role == Role.General || attacker.role == Role.Soldier ||
          target.role == Role.General || uncrossedPawn
        then false
        else
          val exchanged = attacker.role == target.role &&
            replies.contains(Uci.unsafe(s"${uci.dest}${uci.orig}"))
          val captured =
            board.copy(pieces = board.pieces - attackerSquare - targetSquare + (targetSquare -> attacker))
          val protectedTarget = XiangqiRules.canCaptureAt(captured, !side, targetSquare)
          val minorChasesRook = target.role == Role.Chariot &&
            (attacker.role == Role.Horse || attacker.role == Role.Cannon)
          !exchanged && (!protectedTarget || minorChasesRook)
