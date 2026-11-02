package lila.threeKingdoms

/** WXF-style notation on three territories. Every origin includes its unique rank; crossing a frontier names
  * the destination instead of inventing a straight file. This is display notation only: recorded actions
  * retain their stable location keys.
  */
object Notation:
  def square(at: Location): String =
    val firstRank = at.territory match
      case Kingdom.Shu => 'A'
      case Kingdom.Wu => 'F'
      case Kingdom.Wei => 'K'
    s"${at.file + 1}${(firstRank + 4 - at.rank).toChar}"

  def apply(p: Position, move: Move): String =
    val piece = p.piece(move.from).getOrElse(throw IllegalArgumentException("Missing piece"))
    val role = piece.role match
      case Role.Horse => 'H'
      case Role.Elephant => 'E'
      case other => other.code.toUpper
    val origin = s"$role${square(move.from)}"
    if move.from.territory != move.to.territory then s"$origin>${square(move.to)}"
    else if move.from.rank == move.to.rank then s"$origin=${move.to.file + 1}"
    else
      // Appropriated pieces keep their army's direction, just as they do on the board.
      val forward = (move.to.rank > move.from.rank) == (move.from.territory == piece.army)
      val direction = if forward then '+' else '-'
      val destination = piece.role match
        case Role.Horse | Role.Elephant | Role.Advisor => move.to.file + 1
        case _ => math.abs(move.to.rank - move.from.rank)
      s"$origin$direction$destination"
