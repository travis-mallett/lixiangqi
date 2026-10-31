package lila.threeKingdoms

/** Canonical Three Kingdoms playing contract. */
object Rules:
  val maxPlies = 1500
  def pseudoMoves(p: Position, player: Kingdom): Vector[Move] =
    Movement.pseudoMoves(p, player).filter(m => !p.fallen(p.piece(m.from).get))
  def attackers(p: Position, player: Kingdom): Set[Kingdom] =
    p.general(player)
      .fold(Set.empty[Kingdom])(king =>
        p.active.filter(enemy => enemy != player && pseudoMoves(p, enemy).exists(_.to == king))
      )
  def checked(p: Position, player: Kingdom): Boolean =
    attackers(p, player).nonEmpty
  def checks(p: Position): Set[Kingdom] = p.active.filter(checked(p, _))
  def safeMoves(p: Position, player: Kingdom): Vector[Move] =
    pseudoMoves(p, player).filter(m => !checked(moveBoard(p.copy(turn = player), m), player))
  private def hasSafeMove(p: Position, player: Kingdom): Boolean =
    pseudoMoves(p, player).exists(m => !checked(moveBoard(p.copy(turn = player), m), player))
  def noSafeEscape(p: Position): Boolean =
    p.active.size == 3 && checked(p, p.turn) && !hasSafeMove(p, p.turn)
  def perpetualWarning(p: Position): Boolean =
    val occurrences =
      p.repetitions.indices.filter(i => p.repetitions(i) == PositionCodec.repetitionKey(p)).takeRight(2)
    if p.finished || occurrences.size != 2 then false
    else
      val own = p.checkHistory.slice(occurrences(0), occurrences(1)).filter(_._1 == p.turn)
      own.nonEmpty && own.map(_._2).reduce(_ intersect _).nonEmpty
  def legalMoves(p: Position): Vector[Move] =
    if p.finished then Vector.empty
    else
      val safe = safeMoves(p, p.turn)
      if safe.nonEmpty || p.active.size != 3 || !checked(p, p.turn) then safe
      else
        pseudoMoves(p, p.turn).filterNot(m =>
          p.piece(m.to).exists(x => x.role == Role.General && p.active.contains(x.army))
        )

  private def lose(p: Position, player: Kingdom, reason: LossReason, recipient: Option[Kingdom]): Position =
    val armies = Kingdom.values.filter(k => p.controllers(k.ordinal).contains(player)).toSet
    p.copy(
      active = p.active - player,
      eliminated = p.eliminated :+ Elimination(player, reason, p.ply),
      controllers = p.controllers.map(owner => if owner.contains(player) then recipient else owner),
      board = if recipient.isDefined then p.board else p.board.map(_.filterNot(x => armies.contains(x.army))),
      quietPlies = 0,
      stalemateCredit = Vector.fill(3)(None)
    )

  private def moveBoard(p: Position, move: Move): Position =
    val captured = p.piece(move.to)
    val piece = p.piece(move.from).get
    val moved = p.copy(
      board = p.board.updated(move.from.index, None).updated(move.to.index, Some(piece)),
      ply = p.ply + 1,
      quietPlies = if captured.isDefined || piece.role == Role.Soldier then 0 else p.quietPlies + 1,
      lastMove = Some(move)
    )
    captured
      .filter(x => x.role == Role.General && p.active.contains(x.army))
      .fold(moved)(x => lose(moved, x.army, LossReason.Capture, Some(p.turn)))

  private def firstDue(p: Position, candidates: Set[Kingdom]): Option[Kingdom] =
    val start = Kingdom.cycle.indexOf(p.turn)
    (0 until 3).iterator
      .map(n => Kingdom.cycle((start + n) % 3))
      .find(k => p.active.contains(k) && candidates.contains(k))
  private def credit(before: Position, after: Position): Position =
    after.copy(stalemateCredit = Kingdom.values.toVector.map: player =>
      if !after.active.contains(player) || hasSafeMove(after, player) then None
      else if hasSafeMove(before, player) then Option.when(before.turn != player)(before.turn)
      else before.stalemateCredit(player.ordinal).filter(after.active.contains))

  /** Only judge the player whose turn arrived: the third player can still rescue an opponent. */
  def adjudicate(p: Position): Position =
    if p.finished then p
    else if p.active.size == 1 then p.copy(ending = Some(Ending(EndReason.LastSurvivor, p.active, false)))
    else if legalMoves(p).nonEmpty then p
    else
      val inCheck = checked(p, p.turn)
      val recipient = if p.active.size == 2 then (p.active - p.turn).headOption
      else if inCheck then firstDue(p, attackers(p, p.turn))
      else p.stalemateCredit(p.turn.ordinal).filter(p.active.contains)
      val lost = lose(p, p.turn, if inCheck then LossReason.Checkmate else LossReason.Stalemate, recipient)
      adjudicate(lost.copy(turn = lost.nextPlayer.get))

  private def summarize(before: Position, after: Position, move: Option[Move], actor: Kingdom): Transition =
    Transition(
      after,
      move,
      actor,
      move.flatMap(m => before.piece(m.to)),
      Kingdom.values
        .filter(k =>
          before.controllers(k.ordinal) != after.controllers(k.ordinal) &&
            after.controllers(k.ordinal).isDefined
        )
        .toSet,
      after.eliminated.drop(before.eliminated.size),
      checks(after)
    )

  private def history(before: Position, after: Position): Position =
    val key = PositionCodec.repetitionKey(after)
    val reset = after.quietPlies == 0 || before.active != after.active
    val attacked = after.active.filter(k => k != before.turn && attackers(after, k).contains(before.turn))
    val previous =
      if before.repetitions.isEmpty then Vector(PositionCodec.repetitionKey(before)) else before.repetitions
    val hashes = if reset then Vector(key) else previous :+ key
    val traces = if reset then Vector.empty else before.checkHistory :+ (before.turn -> attacked)
    val current = after.copy(repetitions = hashes, checkHistory = traces)
    if current.finished then current
    else
      val occurrences = hashes.indices.filter(i => hashes(i) == key).takeRight(3)
      if occurrences.size == 3 then
        val cycles =
          Vector(traces.slice(occurrences(0), occurrences(1)), traces.slice(occurrences(1), occurrences(2)))
        val offenders = after.active.toVector.flatMap: player =>
          val own = cycles.map(_.filter(_._1 == player))
          val victims =
            if own.forall(_.nonEmpty) then own.flatten.map(_._2).reduce(_ intersect _) else Set.empty[Kingdom]
          Option.when(victims.nonEmpty)(player -> victims)
        if offenders.size == 1 then
          val (offender, victims) = offenders.head
          val lost = lose(current, offender, LossReason.PerpetualCheck, firstDue(current, victims))
          val next = adjudicate(
            if current.turn == offender then lost.copy(turn = lost.nextPlayer.get) else lost
          )
          next.copy(repetitions = Vector(PositionCodec.repetitionKey(next)), checkHistory = Vector.empty)
        else current.copy(ending = Some(Ending(EndReason.Repetition, current.active, true)))
      else if current.quietPlies >= (if current.active.size == 3 then 180 else 120) || current.ply >= maxPlies
      then current.copy(ending = Some(Ending(EndReason.NoProgress, current.active, true)))
      else current

  def play(p: Position, move: Move): Either[String, Transition] =
    if !legalMoves(p).contains(move) then Left("Illegal Three Kingdoms move")
    else Right(playLegal(p, move))
  private[threeKingdoms] def playLegal(p: Position, move: Move): Transition =
    val moved = moveBoard(p, move)
    val credited = if moved.active == p.active then credit(p, moved) else moved
    val next = adjudicate(credited.copy(turn = credited.nextPlayer.get))
    summarize(p, history(p, next), Some(move), p.turn)
  def withdraw(p: Position, player: Kingdom, timeout: Boolean = false): Either[String, Transition] =
    if p.finished || !p.active.contains(player) then Left("Player is not active")
    else
      val lost = lose(
        p.copy(ply = p.ply + 1, lastMove = None),
        player,
        if timeout then LossReason.Timeout else LossReason.Resignation,
        firstDue(p, attackers(p, player))
      )
      val next = adjudicate(if p.turn == player then lost.copy(turn = lost.nextPlayer.get) else lost)
      Right(
        summarize(
          p,
          next.copy(repetitions = Vector(PositionCodec.repetitionKey(next)), checkHistory = Vector.empty),
          None,
          player
        )
      )
  def agreeDraw(p: Position): Either[String, Position] =
    if p.finished then Left("Game has finished")
    else Right(p.copy(ending = Some(Ending(EndReason.Agreement, p.active, true))))
  def event(p: Position, actor: Kingdom, action: String): Either[String, Position] =
    if !p.active.contains(actor) then Left("Player is not active")
    else
      action match
        case "resign" | "timeout" => withdraw(p, actor, action == "timeout").map(_.position)
        case "draw" => agreeDraw(p)
        case _ if actor != p.turn => Left("Not the player's turn")
        case move => Move.parse(move).toRight("Invalid move").flatMap(play(p, _)).map(_.position)
  def notation(p: Position, move: Move): String =
    val piece = p.piece(move.from).get
    s"${p.turn.glyph} ${piece.role.code.toUpper}${move.from.key}${
        if p.piece(move.to).isDefined then "x" else "-"
      }${move.to.key}"
