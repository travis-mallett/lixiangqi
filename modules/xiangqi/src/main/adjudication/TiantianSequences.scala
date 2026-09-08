package lila.xiangqi.adjudication

import lila.xiangqi.Xiangqi.*

/** Pure sequence limits over Tiantian-classified facts, independent of board move generation. */
private[adjudication] object TiantianSequences:

  val forcingLimit = 6
  private val maxCheckingPieces = 3
  private val singlePieceAlternatingLimit = 12
  private val multiPieceAlternatingLimit = 18

  private def sideTail(facts: Vector[MoveFact], side: Side, predicate: MoveFact => Boolean) =
    facts.filter(_.side == side).reverse.takeWhile(predicate).reverse

  def mutual(facts: Vector[MoveFact], predicate: MoveFact => Boolean) =
    Side.values.forall(side => sideTail(facts, side, predicate).size >= forcingLimit)

  private def chaseTail(facts: Vector[MoveFact], side: Side): Vector[MoveFact] =
    val tail = sideTail(facts, side, _.chase)
    tail.lastOption.fold(Vector.empty[MoveFact]): last =>
      // A chase must keep targeting the SAME physical piece, not just the same piece type.
      last.targets
        .map: target =>
          tail.reverse.takeWhile(_.targets.contains(target)).reverse
        .maxByOption(_.size)
        .getOrElse(Vector.empty)

  def mutualChase(facts: Vector[MoveFact]) =
    Side.values.forall(side => chaseTail(facts, side).size >= forcingLimit)

  def forbidden(facts: Vector[MoveFact], candidate: MoveFact): Option[String] =
    if candidate.capture then None
    else
      val next = facts :+ candidate
      val checking = sideTail(next, candidate.side, _.check)
      val checkingLimit = forcingLimit * checking.flatMap(_.checkers).distinct.size.min(maxCheckingPieces)
      val chasing = chaseTail(next, candidate.side)
      // Check takes priority over the opponent's chase, even before the checking limit is reached.
      val opponentChecks = sideTail(facts, !candidate.side, _.check)
      val forcing = sideTail(next, candidate.side, _.forcing)
      val alternating = forcing.reverse.zipWithIndex
        .takeWhile: (fact, index) =>
          fact.check == (if index % 2 == 0 then candidate.check else !candidate.check)
        .map(_._1)
      val pieces = alternating.flatMap(f => f.checkers ++ f.chasers).distinct.size
      val alternatingLimit = if pieces <= 1 then singlePieceAlternatingLimit else multiPieceAlternatingLimit
      if candidate.check && checking.size > checkingLimit then Some("perpetual-check")
      else if candidate.chase && chasing.size > forcingLimit && opponentChecks.size < 2 then
        Some("perpetual-chase")
      else if alternating.size > alternatingLimit then Some("alternating-check-chase")
      else None
