package lila.threeKingdoms

/** Bounded Max-n search. Each player maximizes its own evaluation; opponents never share a team. This
  * deliberately modest engine is also the analysis engine, and runs in a browser worker.
  */
object Engine:
  final case class Line(
      scores: Vector[Int],
      line: Vector[Move],
      active: Set[Kingdom],
      winners: Option[Set[Kingdom]]
  )
  final case class Result(
      lines: Vector[Line],
      depth: Int,
      nodes: Int
  )

  def evaluate(p: Position): Vector[Int] =
    val material = Array.fill(3)(0)
    p.board.zipWithIndex.foreach:
      case (Some(piece), index) =>
        p.controller(piece)
          .foreach: owner =>
            val at = Location.at(index)
            val soldier = if piece.role == Role.Soldier then
              if at.territory == piece.army then at.rank * 8 else 100 + (4 - at.rank) * 15
            else 0
            val development = if Set(Role.Horse, Role.Cannon, Role.Chariot).contains(piece.role) then
              if at.territory == piece.army then at.rank * 5 else 30
            else 0
            material(owner.ordinal) += (if p.fallen(piece) then 0
                                        else piece.role.material) + soldier + development
      case _ => ()
    Kingdom.values.toVector.map: player =>
      // Reaching the duel guarantees at least second place. Without this term, removing
      // a weak opponent could reduce a player's material score against the remaining
      // stronger opponent, making a one-ply engine avoid capturing a free general.
      val survival = p.eliminated.size * 100000
      p.ending match
        case Some(e) if e.winners.contains(player) => if e.draw then survival else 1000000
        case _ if !p.active.contains(player) =>
          -1000000 + p.eliminated.indexWhere(_.player == player) * 100000
        case _ =>
          survival + material(player.ordinal) -
            p.active.filterNot(_ == player).map(k => material(k.ordinal)).sum / (p.active.size - 1).max(1)

  def search(
      p: Position,
      maxDepth: Int = 3,
      maxNodes: Int = 4000,
      multiPv: Int = 1,
      emit: Result => Unit = _ => ()
  ): Result =
    val limit = maxNodes.max(1).min(100000)
    val depthLimit = maxDepth.max(1).min(6)
    var nodes = 0
    var exhausted = false
    def ordered(position: Position): Vector[Move] =
      Rules
        .legalMoves(position)
        .sortBy: move =>
          -position.piece(move.to).fold(0)(piece => piece.role.material) * 10 -
            (if move.to.territory != position.piece(move.from).get.army then 5 else 0)
    def leaf(position: Position): Line =
      Line(evaluate(position), Vector.empty, position.active, position.ending.map(_.winners))
    def prepend(move: Move, line: Line): Line = line.copy(line = move +: line.line)
    def visit(position: Position, depth: Int): Line =
      nodes += 1
      if depth == 0 || position.finished then leaf(position)
      else
        val moves = ordered(position)
        if moves.isEmpty then leaf(Rules.adjudicate(position))
        else
          var best: Option[Line] = None
          val iterator = moves.iterator
          while iterator.hasNext && !exhausted do
            if nodes >= limit then exhausted = true
            else
              val move = iterator.next()
              val candidate = prepend(move, visit(Rules.playLegal(position, move).position, depth - 1))
              if best.forall(_.scores(position.turn.ordinal) < candidate.scores(position.turn.ordinal)) then
                best = Some(candidate)
          best.getOrElse(leaf(position))
    val fallback = ordered(p).headOption
    // Depth zero is explicitly unsearched. Keep a legal fallback for very small bot budgets.
    var result = Result(Vector(leaf(p).copy(line = fallback.toVector)), 0, 0)
    var depth = 1
    while depth <= depthLimit && !exhausted && !p.finished do
      val moves = ordered(p)
      val candidates = Vector.newBuilder[Line]
      if moves.isEmpty then
        if nodes < limit then candidates += visit(p, depth)
        else exhausted = true
      else
        val iterator = moves.iterator
        while iterator.hasNext && !exhausted do
          if nodes >= limit then exhausted = true
          else
            val move = iterator.next()
            candidates += prepend(move, visit(Rules.playLegal(p, move).position, depth - 1))
      // Every alternative must complete the same depth before it is published or ranked.
      if !exhausted then
        val lines =
          candidates.result().sortBy(line => -line.scores(p.turn.ordinal)).take(multiPv.max(1).min(5))
        result = Result(lines, depth, nodes)
        emit(result)
      depth += 1
    result.copy(nodes = nodes)
