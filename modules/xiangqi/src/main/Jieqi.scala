package lila.xiangqi

import java.security.SecureRandom

import Xiangqi.*

/** The deal is server-only. Public states contain X/x, never concealed identities. */
object Jieqi:
  val startFen = "xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w j - 0 1"
  private val random = new SecureRandom
  lazy val startingPieces: Map[Square, Piece] = Fen.board(Xiangqi.startFen).get.pieces

  final case class Deal(identities: Map[String, String]):
    def at(square: String): Role = Role.byKey(identities(square))

    def validate: Either[String, Deal] =
      val expected = startingPieces.filter(_._2.role != Role.General)
      Either.cond(
        identities.keySet == expected.keySet.map(_.key) && Side.values.forall: side =>
          val squares = expected.filter(_._2.side == side).keys.toVector
          squares.map(s => identities(s.key)).sorted == squares.map(s => expected(s).role.key).sorted
        ,
        this,
        "Invalid Jieqi deal"
      )

    override def toString = "Jieqi.Deal(<private>)"

  def deal(): Deal =
    val identities = Side.values.toVector.flatMap: side =>
      val slots = startingPieces.toVector
        .filter((_, piece) => piece.side == side && piece.role != Role.General)
        .sortBy(_._1.key)
      val roles = slots.map(_._2.role.key).toArray
      for i <- (roles.length - 1) to 1 by -1 do
        val j = random.nextInt(i + 1)
        val value = roles(i)
        roles(i) = roles(j)
        roles(j) = value
      slots.map(_._1.key).zip(roles)
    Deal(identities.toMap)

  /** A concealed capture has no public role. Its original square identifies the private deal entry. */
  final case class Capture(side: Side, square: String, role: Option[String], concealed: Boolean, ply: Int)

  /** An information set, not a determinization. Unknown captured pieces remain in the inventory. */
  final case class Observation(fen: String, remaining: Map[String, Int])

  def observation(game: Game, viewer: Option[Side]): Observation =
    observation(game.state.copy(captures = captures(game, viewer)))

  def observation(state: State): Observation =
    val board = Fen.board(state.fen).get
    def symbol(side: Side, role: Role): String =
      val letter = role.forsyth.toString
      if side.red then letter.toUpperCase else letter.toLowerCase
    val inventory = startingPieces.values
      .filter(_.role != Role.General)
      .toVector
      .groupMapReduce(p => symbol(p.side, p.role))(_ => 1)(_ + _)
    val known = board.pieces.toVector.collect:
      case (square, piece) if !board.concealed(square) && piece.role != Role.General =>
        symbol(piece.side, piece.role)
    val captured = state.captures.flatMap(c => c.role.map(r => symbol(c.side, Role.byKey(r))))
    val counts = (known ++ captured).groupMapReduce(identity)(_ => 1)(_ + _)
    Observation(state.fen, inventory.map((piece, count) => piece -> (count - counts.getOrElse(piece, 0))))

  def captures(game: Game, viewer: Option[Side]): Vector[Capture] =
    game.state.captures.map: capture =>
      if capture.concealed && viewer.contains(!capture.side) then
        capture.copy(role = game.deal.map(_.at(capture.square).key))
      else capture

  def publicStates(game: Game, viewer: Option[Side]): Vector[State] =
    val ledger = captures(game, viewer)
    game.states.map(state => state.copy(captures = ledger.filter(_.ply <= state.ply)))

  /** Explicit analysis knowledge, never a lookup into a live game's private deal. */
  def withKnownCaptures(game: Game, known: Map[String, String]): Either[String, Game] =
    if known.size > 30 || known.exists((square, role) =>
        !startingPieces.keys.exists(_.key == square) || !Role.byKey.get(role).exists(_ != Role.General)
      )
    then Left("Invalid captured-piece knowledge")
    else
      val state = game.state.copy(captures =
        game.state.captures.map(c =>
          if c.concealed then c.copy(role = known.get(c.square).orElse(c.role)) else c
        )
      )
      Either.cond(
        observation(state).remaining.values.forall(_ >= 0),
        game.copy(states = game.states.init :+ state),
        "Captured-piece knowledge exceeds the inventory"
      )

  def initial(deal: Deal = Jieqi.deal()): Either[String, Game] =
    deal.validate.flatMap: valid =>
      XiangqiRules
        .initialGame(Some(startFen), adjudication.Ruleset.Jieqi)
        .map(_.copy(deal = Some(valid)))

  def analysisMove(game: Game, uci: Uci, reveal: Option[String]): Either[String, MoveResult] =
    val role = reveal.flatMap(Role.byKey.get)
    if reveal.isDefined && role.isEmpty then Left("Invalid Jieqi reveal")
    else move(game, uci, role)

  /** Explicit analysis outcome; callers cannot obtain a real game's secret through this API. */
  def move(game: Game, uci: Uci, reveal: Option[Role] = None): Either[String, MoveResult] =
    val before = Fen.board(game.state.fen).get
    val orig = Square.fromKey(uci.orig).get
    val dest = Square.fromKey(uci.dest).get
    val hidden = before.concealed(orig)
    val identity = if hidden then game.deal.map(_.at(uci.orig)).orElse(reveal) else None
    if game.state.ended then Left("This Jieqi game has ended")
    else if !game.state.legalMoves.contains(uci) then Left("Illegal Jieqi move")
    else if hidden && identity.isEmpty then Left("A hypothetical reveal is required")
    else if !hidden && reveal.nonEmpty then Left("Only a concealed piece can be revealed")
    else if identity.contains(Role.General) then Left("A concealed piece cannot be a general")
    else if hidden && game.deal.isEmpty && identity.exists: role =>
        val letter = if game.state.turn.red then role.forsyth.toUpper else role.forsyth
        observation(game.state).remaining.getOrElse(letter.toString, 0) <= 0
    then Left("This piece is not in the remaining hidden inventory")
    else
      XiangqiRules
        .revealedMove(game.state.fen, uci, identity)
        .map: moved =>
          val capture = before
            .pieceAt(dest)
            .map: piece =>
              Capture(
                piece.side,
                dest.key,
                Option.unless(before.concealed(dest))(piece.role.key),
                before.concealed(dest),
                moved.ply
              )
          val withCaptures = moved.copy(captures = game.state.captures ++ capture)
          val state = adjudication.JieqiRules.afterMove(game, withCaptures)
          withCaptures.copy(
            checkmate = state.mate,
            legalMoves = state.legalMoves,
            gameResult = state.gameResult,
            immediateEnd = state.immediateEnd,
            optionalEnd = state.optionalEnd,
            adjudication = state.adjudication,
            termination = state.termination,
            variation = state.variation
          )
