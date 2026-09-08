package lila.xiangqi.adjudication

import lila.xiangqi.Xiangqi.*
import lila.xiangqi.XiangqiRules

/** Tiantian's in-app limits. Counters measure individual moves, never FEN fullmove numbers. Piece identities
  * survive moves, so two horses are two checking pieces even though their roles match.
  */
object TiantianRules extends AdjudicationPolicy:

  import TiantianSequences.{ forbidden, forcingLimit, mutual, mutualChase }

  private val naturalPlyLimit = 120
  private val playedPlyLimit = 400
  private val countedChecksPerSide = 10
  private val quietOccurrences = 5

  private val attackers = Set(Role.Chariot, Role.Horse, Role.Cannon, Role.Soldier)

  def initial(state: State): State =
    val ids = Fen
      .board(state.fen)
      .toVector
      .flatMap(_.pieces.keys)
      .map: square =>
        val key = squareKey(square)
        key -> key
    finishMaterial(state.copy(adjudication = Some(AdjudicationState(ids.toMap, 0, 0, 0, None))))

  def afterMove(game: Game, move: MoveResult): State =
    val previous = game.state.adjudication.getOrElse(initial(game.state).adjudication.get)
    val before = Fen.board(game.state.fen).get
    val after = Fen.board(move.fen).get
    val fact = new TiantianThreats.Position(before, previous, !move.turn).classify(after, move)
    val ids = (previous.identities - move.move.orig - move.move.dest) +
      (move.move.dest -> previous.identities(move.move.orig))
    val oldChecks = if fact.side == Side.Red then previous.redChecks else previous.blackChecks
    val countMove = !fact.check || oldChecks < countedChecksPerSide
    val next = AdjudicationState(
      identities = ids,
      naturalPlies = if move.capture then 0 else previous.naturalPlies + (if countMove then 1 else 0),
      redChecks = if move.capture then 0
      else previous.redChecks + (if fact.side == Side.Red && fact.check then 1 else 0),
      blackChecks = if move.capture then 0
      else previous.blackChecks + (if fact.side == Side.Black && fact.check then 1 else 0),
      fact = Some(fact)
    )
    val state = finishMaterial(move.state.copy(adjudication = Some(next)))
    val states = game.states :+ state
    val facts = recentFacts(states)
    if state.ended then state // Board mate/stalemate take precedence over both move limits.
    else if next.naturalPlies >= naturalPlyLimit then draw(state, "no-capture")
    else if game.moves.size + 1 >= playedPlyLimit then draw(state, "move-limit")
    else if mutual(facts, _.check) then draw(state, "mutual-check")
    else if mutualChase(facts) then draw(state, "mutual-chase")
    else if quietRepetition(states) then draw(state, "repetition")
    else restrict(state, facts)

  private def finishMaterial(state: State): State =
    if state.ended then state
    else if Fen.board(state.fen).exists(_.pieces.values.forall(p => !attackers(p.role))) then
      // No attacking pieces on BOTH sides is an automatic draw. This does not assert that a
      // single side cannot win by stalemate, and must not activate chess timeout exceptions.
      draw(state.copy(insufficientMaterial = true), "no-attacking-material")
    else state

  private def draw(state: State, reason: String): State =
    state.copy(
      gameResult = Result.Draw,
      immediateEnd = Ending(true, 0),
      optionalEnd = Ending(false, 0),
      termination = Some(reason),
      variation = None,
      legalMoves = Vector.empty
    )

  private def squareKey(square: Square) = s"${('a' + square.file).toChar}${square.rank}"
  private def positionKey(state: State) = state.fen.split(' ').take(2).mkString(" ")

  private def recentFacts(states: Vector[State]): Vector[MoveFact] =
    states.reverseIterator.flatMap(_.adjudication.flatMap(_.fact)).takeWhile(!_.capture).toVector.reverse

  private def quietRepetition(states: Vector[State]): Boolean =
    val lastKey = positionKey(states.last)
    val occurrences =
      states.indices.filter(i => positionKey(states(i)) == lastKey).takeRight(quietOccurrences)
    occurrences.size == quietOccurrences && states
      .drop(occurrences.head + 1)
      .forall: state =>
        state.adjudication.flatMap(_.fact).exists(f => !f.capture && !f.forcing && !f.responding)

  // The variation enforcement below is shared by player move lists and server validation.
  private def restrict(state: State, facts: Vector[MoveFact]): State =
    val own = facts.filter(_.side == state.turn)
    if own.reverse.takeWhile(_.forcing).size < forcingLimit then state
    else
      val before = Fen.board(state.fen).get
      val previous = state.adjudication.get
      val threats = new TiantianThreats.Position(before, previous, state.turn)
      val candidates = state.legalMoves.map: uci =>
        val move = XiangqiRules.boardMove(state.fen, uci).toOption.get
        val reason =
          if move.capture || move.state.ended then None
          else forbidden(facts, threats.classify(Fen.board(move.fen).get, move))
        uci -> reason
      val permitted = candidates.collect { case (uci, None) => uci }
      val reason = candidates.flatMap(_._2).headOption
      if permitted.isEmpty then
        state.copy(
          legalMoves = Vector.empty,
          gameResult = if state.turn == Side.Red then Result.BlackWin else Result.RedWin,
          immediateEnd = Ending(true, -1),
          termination = Some("forced-variation"),
          variation = reason
        )
      else state.copy(legalMoves = permitted, variation = reason)
