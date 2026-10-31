package lila.threeKingdoms

/** Mechanical moves on the canonical board topology. */
private[threeKingdoms] object Movement:
  private def geometric(p: Position, from: Location, piece: Piece): Vector[Location] =
    import Role.*
    def empty(at: Location): Boolean = p.piece(at).isEmpty
    piece.role match
      case Chariot =>
        Topology
          .rays(from.index)
          .flatMap: ray =>
            val (clear, occupied) = ray.span(empty)
            clear ++ occupied.headOption
      case Cannon =>
        Topology
          .rays(from.index)
          .flatMap: ray =>
            val (clear, occupied) = ray.span(empty)
            clear ++ occupied.drop(1).find(at => !empty(at))
      case Horse => Topology.horses(from.index).filter(j => empty(j.blockedAt)).map(_.to)
      case Elephant => Topology.elephants(from.index).filter(j => empty(j.blockedAt)).map(_.to)
      case Advisor => Topology.advisors(from.index)
      case General =>
        val flying = Topology
          .rays(from.index)
          .drop(2)
          .flatMap: ray =>
            ray
              .find(at => !empty(at))
              .filter(at => p.piece(at).exists(x => x.role == General && p.active.contains(x.army)))
        Topology.adjacent(from).filter(_.palace) ++ flying
      case Soldier => Topology.soldiers(from, piece.army)

  def pseudoMoves(p: Position, player: Kingdom): Vector[Move] =
    p.board.zipWithIndex.flatMap:
      case (Some(piece), index) if p.controls(player, piece) =>
        val from = Location.at(index)
        geometric(p, from, piece).distinct
          .filter(to => !p.piece(to).exists(p.controls(player, _)))
          .map(Move(from, _))
      case _ => Vector.empty
