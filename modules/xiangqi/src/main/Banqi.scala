package lila.xiangqi

import java.security.SecureRandom

import Xiangqi.*
import adjudication.Ruleset

/** Taiwanese competition Banqi. Side in Game/State identifies a stable seat (Red opens). Piece letters
  * identify actual armies. Only the referee sees the shuffled layout.
  */
object Banqi:
  private val order = "KABRNCPkabrncp"
  val inventory: String = order.flatMap(c =>
    c.toLower match
      case 'k' => c.toString
      case 'p' => c.toString * 5
      case _ => c.toString * 2
  )
  val startFen = s"${Vector.fill(8)("****").mkString("/")} w banqi - 0 1 $inventory"
  private val random = new SecureRandom
  private val squares = (1 to 8).flatMap(rank => (0 until 4).map(Square(_, rank))).toVector
  private val directions = Vector((0, 1), (0, -1), (1, 0), (-1, 0))
  private def army(c: Char): Side = if c.isUpper then Side.Red else Side.Black
  private def onBoard(s: Square) = s.file >= 0 && s.file < 4 && s.rank >= 1 && s.rank <= 8

  private def symbolPiece(c: Char) = Piece(army(c), Role.byForsyth(c.toLower))

  final class Deal private (val encoded: String):
    private[Banqi] def at(s: Square): Char = encoded((s.rank - 1) * 4 + s.file)
    override def equals(other: Any): Boolean = other match
      case d: Deal => encoded == d.encoded
      case _ => false
    override def hashCode(): Int = encoded.hashCode
    override def toString = "Banqi.Deal(<private>)"

  object Deal:
    def read(value: String): Either[String, Deal] =
      Either.cond(
        value.length == 32 && value.sorted == inventory.sorted,
        new Deal(value),
        "Invalid Banqi deal"
      )
    def fresh(): Deal =
      val deck = inventory.toArray
      for i <- 31 until 0 by -1 do
        val j = random.nextInt(i + 1)
        val tmp = deck(i)
        deck(i) = deck(j)
        deck(j) = tmp
      new Deal(String(deck))

  enum Action:
    case Flip(square: Square)
    case Move(from: Square, to: Square)

    def uci: Uci = this match
      case Flip(at) => Uci.unsafe(at.key + at.key)
      case Move(from, to) => Uci.unsafe(from.key + to.key)

  /** Public position, including the remaining multiset for independently playable diagrams. */
  final case class Position(
      cells: Map[Square, Char],
      turn: Side,
      firstArmy: Option[Side],
      quiet: Int,
      fullMove: Int,
      remaining: String
  ):
    def ply: Int = (fullMove - 1) * 2 + turn.fold(0, 1)
    def movingArmy: Option[Side] = firstArmy.map(s => turn.fold(s, !s))
    def board: Board = Board(
      cells.collect { case (sq, c) if c != '*' => sq -> symbolPiece(c) },
      cells.collect { case (sq, '*') => sq }.toSet,
      GameVariant.Banqi
    )

    lazy val placement = (8 to 1 by -1)
      .map: rank =>
        val row = (0 until 4).map(f => cells.getOrElse(Square(f, rank), '.')).mkString
        "\\.+".r.replaceAllIn(row, m => m.matched.length.toString)
      .mkString("/")
    def key = s"$placement ${turn.fold("w", "b")} banqi ${firstArmy.fold("-")(_.fold("r", "b"))}"
    def fen = s"$key $quiet $fullMove ${if remaining.isEmpty then "-" else remaining}"

    private def ordinary(attacker: Char, victim: Char) =
      val a = attacker.toUpper
      val v = victim.toUpper
      if a == 'P' then v == 'P' || v == 'K'
      else !(a == 'K' && v == 'P') && order.indexOf(a) <= order.indexOf(v)

    lazy val actions: Vector[Action] = squares.flatMap: from =>
      cells.get(from) match
        case Some('*') => Vector(Action.Flip(from))
        case Some(attacker) if movingArmy.contains(army(attacker)) =>
          directions.flatMap: (dx, dy) =>
            val next = Square(from.file + dx, from.rank + dy)
            if !onBoard(next) then Vector.empty
            else if attacker.toUpper == 'C' then
              val ray = Iterator.iterate(next)(s => Square(s.file + dx, s.rank + dy)).takeWhile(onBoard)
              val target = ray.filter(cells.contains).drop(1).nextOption()
              Option.when(!cells.contains(next))(Action.Move(from, next)).toVector ++
                target
                  .filter(s => cells(s) != '*' && army(cells(s)) != army(attacker))
                  .map(Action.Move(from, _))
            else if cells
                .get(next)
                .forall(v => v != '*' && army(v) != army(attacker) && ordinary(attacker, v))
            then Vector(Action.Move(from, next))
            else Vector.empty
        case _ => Vector.empty

    def state(ancestors: Vector[State], captures: Vector[Jieqi.Capture], reveal: Option[String]): State =
      def hasPieces(side: Side): Boolean = remaining.exists(c => army(c) == side) ||
        cells.valuesIterator.exists(c => c != '*' && army(c) == side)
      val eliminated = movingArmy.flatMap: mover =>
        if !hasPieces(mover) then Some(turn)
        else Option.unless(hasPieces(!mover))(!turn)
      val reason =
        if eliminated.isDefined then Some("elimination")
        else if actions.isEmpty then Some("immobilization")
        else if quiet >= 30 then Some("noProgress")
        else if quiet >= 4 && ancestors.takeRight(quiet).count(_.fen.startsWith(key + " ")) >= 2 then
          Some("threefold-repetition")
        else None
      val result = reason match
        case Some("elimination" | "immobilization") =>
          eliminated.getOrElse(turn).fold(Result.BlackWin, Result.RedWin)
        case Some(_) => Result.Draw
        case None => Result.Ongoing
      State(
        "banqi",
        fen,
        ply,
        turn,
        if reason.isEmpty then actions.map(_.uci) else Vector.empty,
        check = false,
        insufficientMaterial = false,
        gameResult = result,
        immediateEnd = Ending(reason.isDefined, if result.winner.isDefined then -1 else 0),
        optionalEnd = Ending(false, 0),
        termination = reason,
        captures = captures,
        reveal = reveal
      )

  def isFen(fen: String): Boolean = fen.split(" ", 4).lift(2).contains("banqi")

  def read(fen: String): Either[String, Position] =
    val invalid = Left("Invalid Banqi position")
    fen.split(" ", -1).toList match
      case placement :: seat :: "banqi" :: assigned :: clock :: full :: pool :: Nil =>
        val rows = placement.split("/", -1)
        val bag = if pool == "-" then "" else pool
        if rows.length != 8 || !Set("w", "b")(seat) || !Set("-", "r", "b")(assigned) ||
          !clock.toIntOption.exists(n => n >= 0 && n <= 30) || !full.toIntOption.exists(n =>
            n >= 1 && n <= Int.MaxValue / 2
          ) ||
          !rows.forall(row =>
            row.nonEmpty && row.length <= 4 && row.forall(c => order.contains(c) || "*1234".contains(c))
          ) ||
          bag.length > 32 || !bag.forall(order.contains(_))
        then invalid
        else
          val expanded = rows.map(_.flatMap(c => if c.isDigit then "." * c.asDigit else c.toString))
          val faces = expanded.mkString.filter(order.contains(_))
          if !expanded.forall(_.length == 4) || placement.count(_ == '*') != bag.length ||
            order.exists(c => faces.count(_ == c) + bag.count(_ == c) > inventory.count(_ == c)) ||
            ((assigned == "-") != (bag.length == 32)) || (assigned == "-" && (seat != "w" || full != "1" || clock != "0"))
          then invalid
          else
            val cells = expanded.zipWithIndex
              .flatMap((row, i) =>
                row.zipWithIndex.collect { case (c, f) if c != '.' => Square(f, 8 - i) -> c }
              )
              .toMap
            Right(
              Position(
                cells,
                if seat == "w" then Side.Red else Side.Black,
                Option.unless(assigned == "-")(if assigned == "r" then Side.Red else Side.Black),
                clock.toInt,
                full.toInt,
                order.flatMap(c => c.toString * bag.count(_ == c))
              )
            )
      case _ => invalid

  def analysis(fen: String): Either[String, Game] = read(fen).map: pos =>
    Game(
      pos.fen,
      Vector.empty,
      Vector.empty,
      Vector(pos.state(Vector.empty, Vector.empty, None)),
      Ruleset.Banqi
    )

  def initial(deal: Deal = Deal.fresh()): Either[String, Game] =
    analysis(startFen).map(_.copy(banqiDeal = Some(deal)))

  def record(uci: Uci, reveal: Option[String]): String =
    reveal.fold(s"${uci.orig}-${uci.dest}")(c => s"${uci.orig}($c)")

  private val flipRecord = "([a-d][1-8])\\(([KABRNCPkabrncp])\\)".r
  private val moveRecord = "([a-d][1-8])-([a-d][1-8])".r
  def readRecord(text: String): Either[String, (Uci, Option[String])] = text match
    case flipRecord(at, piece) => Right(Uci.unsafe(at + at) -> Some(piece))
    case moveRecord(from, to) if from != to => Right(Uci.unsafe(from + to) -> None)
    case _ => Left(s"Invalid Banqi record: $text")

  def play(game: Game, uci: Uci): Either[String, MoveResult] =
    val identity = Option
      .when(uci.orig == uci.dest)(
        game.banqiDeal.flatMap(d => Square.fromKey(uci.orig).filter(onBoard).map(s => d.at(s).toString))
      )
      .flatten
    advance(game, uci, identity)

  /** Analysis and import resolve only explicit public outcomes, never the referee's deal. */
  def advance(game: Game, uci: Uci, reveal: Option[String]): Either[String, MoveResult] =
    if game.state.ended || !game.state.legalMoves.contains(uci) then Left("Illegal Banqi action")
    else
      read(game.state.fen).flatMap: pos =>
        val from = Square.fromKey(uci.orig).get
        val to = Square.fromKey(uci.dest).get
        val flip = from == to
        if flip != reveal.isDefined || reveal.exists(s => s.length != 1 || !pos.remaining.contains(s.head))
        then Left("A flip requires one available Banqi identity")
        else
          val captured = Option.unless(flip)(pos.cells.get(to)).flatten
          val next = pos.copy(
            cells = (pos.cells - from).updated(to, reveal.fold(pos.cells(from))(_.head)),
            firstArmy = pos.firstArmy.orElse(reveal.map(s => army(s.head))),
            turn = !pos.turn,
            fullMove = pos.fullMove + pos.turn.fold(0, 1),
            quiet = if flip || captured.isDefined then 0 else pos.quiet + 1,
            remaining = reveal.fold(pos.remaining)(s => pos.remaining.patch(pos.remaining.indexOf(s), "", 1))
          )
          val captures = game.state.captures ++ captured.map(c =>
            Jieqi.Capture(army(c), to.key, Some(Role.byForsyth(c.toLower).key), false, next.ply)
          )
          val state = next.state(game.states, captures, reveal)
          val label = record(uci, reveal)
          Right(
            MoveResult(
              uci,
              label,
              label,
              captured.isDefined,
              false,
              state.variant,
              state.fen,
              state.ply,
              state.turn,
              state.legalMoves,
              false,
              insufficientMaterial = false,
              gameResult = state.gameResult,
              immediateEnd = state.immediateEnd,
              optionalEnd = state.optionalEnd,
              termination = state.termination,
              captures = captures,
              reveal = reveal
            )
          )
