package lila.xiangqi.adjudication

import lila.xiangqi.Xiangqi.*

/** Tiantian classification of one move; preceding facts live in preceding game states. `piece`, `checkers`,
  * `chasers`, and `targets` are stable physical identities (initial square keys), not current squares.
  * `responding` marks a move following a forcing move or made while in check, excluding that move from quiet
  * repetition even if it creates no threat of its own.
  */
final case class MoveFact(
    side: Side,
    piece: String,
    checkers: Vector[String],
    chasers: Vector[String],
    targets: Vector[String],
    capture: Boolean,
    responding: Boolean
):
  def check = checkers.nonEmpty
  def chase = !check && targets.nonEmpty
  def forcing = check || chase

/** Persisted Tiantian counters and current-square to physical-identity mapping. A second policy may require
  * its own versioned payload; these counters are not universal rules.
  */
final case class AdjudicationState(
    identities: Map[String, String],
    naturalPlies: Int,
    redChecks: Int,
    blackChecks: Int,
    fact: Option[MoveFact]
)
