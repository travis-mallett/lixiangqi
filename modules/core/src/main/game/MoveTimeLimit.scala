package lila.core
package game

/** A hard ceiling on one move's duration. The main clock bank runs at the same time. */
case class MoveTimeLimit(
    seconds: Int,
    first: Option[MoveTimeLimit.FirstPhase] = None
):

  require(MoveTimeLimit.validSeconds(seconds), s"Invalid move-time limit: $seconds")

  def limitForMove(moveNumber: Int): Int =
    first.filter(moveNumber <= _.moves).fold(seconds)(_.seconds)

  def normalized: MoveTimeLimit =
    if first.exists(_.seconds == seconds) then copy(first = None) else this

object MoveTimeLimit:

  case class FirstPhase(moves: Int, seconds: Int):
    require(validFirstMoves(moves), s"Invalid first-phase move count: $moves")
    require(validSeconds(seconds), s"Invalid first-phase move-time limit: $seconds")

  val minSeconds = 1
  val maxSeconds = 300
  val minFirstMoves = 1
  val maxFirstMoves = 20

  def validSeconds(seconds: Int) = seconds >= minSeconds && seconds <= maxSeconds
  def validFirstMoves(moves: Int) = moves >= minFirstMoves && moves <= maxFirstMoves
