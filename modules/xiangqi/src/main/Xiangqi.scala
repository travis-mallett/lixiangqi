package lila.xiangqi

import lila.xiangqi.adjudication.{ AdjudicationState, Ruleset }

object Xiangqi:
  val startFen =
    "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"

  object Fen:
    private val pieces = "kabnrcpKABNRCP"

    def isValid(value: String): Boolean =
      value.trim.split("\\s+").toList match
        case board :: turn :: "-" :: "-" :: halfMove :: fullMove :: Nil =>
          val ranks = board.split("/", -1)
          ranks.length == 10 &&
          ranks.forall(validRank) &&
          (turn == "w" || turn == "b") &&
          halfMove.toIntOption.exists(_ >= 0) &&
          fullMove.toIntOption.exists(_ >= 1)
        case _ => false

    private def validRank(rank: String): Boolean =
      rank.nonEmpty && rank
        .foldLeft(Option(0 -> false)): (state, char) =>
          state.flatMap: (width, previousWasDigit) =>
            if char >= '1' && char <= '9' && !previousWasDigit then Some((width + char.asDigit) -> true)
            else if pieces.contains(char) then Some((width + 1) -> false)
            else None
        .exists(_._1 == 9)

    def board(value: String): Option[Board] =
      Option.when(isValid(value)):
        val pieces = Map.newBuilder[Square, Piece]
        value
          .takeWhile(_ != ' ')
          .split("/", -1)
          .zipWithIndex
          .foreach: (rank, rankIndex) =>
            var file = 0
            rank.foreach: char =>
              if char.isDigit then file += char.asDigit
              else
                val side = if char.isUpper then Side.Red else Side.Black
                Role
                  .fromForsyth(char.toLower)
                  .foreach: role =>
                    pieces += Square(file, 10 - rankIndex) -> Piece(side, role)
                file += 1
        Board(pieces.result())

  opaque type Uci = String

  object Uci:
    private val pattern = "^[a-i](?:10|[1-9])[a-i](?:10|[1-9])$".r

    def from(value: String): Either[String, Uci] =
      Either.cond(pattern.matches(value), value, s"Invalid Xiangqi UCI move: $value")

    def unsafe(value: String): Uci = from(value).fold(sys.error, identity)

  extension (uci: Uci)
    def value: String = uci
    def orig: String = if uci.startsWith("10", 1) then uci.take(3) else uci.take(2)
    def dest: String = uci.drop(orig.length)

  final case class Move(uci: Uci, notation: String, chineseNotation: String)

  enum Side(val key: String):
    case Red extends Side("red")
    case Black extends Side("black")

    def unary_! : Side = if this == Red then Black else Red
    def red: Boolean = this == Red
    def black: Boolean = this == Black
    def fold[A](red: => A, black: => A): A = if this == Red then red else black

  object Side:
    def fromKey(value: String): Either[String, Side] =
      Side.values.find(_.key == value).toRight(s"Invalid Xiangqi side: $value")

  final case class BySide[A](red: A, black: A):
    def apply(side: Side): A = side.fold(red, black)
    def map[B](f: A => B): BySide[B] = BySide(f(red), f(black))
    def mapList[B](f: A => B): List[B] = List(f(red), f(black))
    def toList: List[A] = List(red, black)
    def zip[B](other: BySide[B]): BySide[(A, B)] = BySide(red -> other.red, black -> other.black)
    def update(side: Side, f: A => A): BySide[A] =
      side.fold(copy(red = f(red)), copy(black = f(black)))
    def swap: BySide[A] = BySide(black, red)
    def toPair: (A, A) = red -> black
    def forall(f: A => Boolean): Boolean = f(red) && f(black)
    def exists(f: A => Boolean): Boolean = f(red) || f(black)
    def zipSide: List[(Side, A)] = List(Side.Red -> red, Side.Black -> black)
    def mapWithSide[B](f: (Side, A) => B): BySide[B] =
      BySide(f(Side.Red, red), f(Side.Black, black))
    def mapReduce[B](f: A => B)(combine: (B, B) => B): B = combine(f(red), f(black))
    def flatten[B](using ev: A <:< Option[B]): List[B] = toList.flatMap(ev)
    def traverse[F[_], B](f: A => F[B])(using app: cats.Applicative[F]): F[BySide[B]] =
      app.map2(f(red), f(black))(BySide(_, _))

  object BySide:
    def apply[A](f: Side => A): BySide[A] = BySide(f(Side.Red), f(Side.Black))
    def fill[A](value: => A): BySide[A] = BySide(value, value)
    def fromPair[A](pair: (A, A)): BySide[A] = BySide(pair._1, pair._2)

  enum NotationStyle(val key: String):
    case English extends NotationStyle("english")
    case Chinese extends NotationStyle("chinese")

  enum Role(val key: String, val name: String, val forsyth: Char, val material: Int):
    case General extends Role("general", "General", 'k', 0)
    case Advisor extends Role("advisor", "Advisor", 'a', 2)
    case Elephant extends Role("elephant", "Elephant", 'b', 2)
    case Horse extends Role("horse", "Horse", 'n', 4)
    case Chariot extends Role("chariot", "Chariot", 'r', 9)
    case Cannon extends Role("cannon", "Cannon", 'c', 5)
    case Soldier extends Role("soldier", "Soldier", 'p', 1)

  object Role:
    val byForsyth = Role.values.map(role => role.forsyth -> role).toMap
    val byKey = Role.values.map(role => role.key -> role).toMap
    def fromForsyth(value: Char): Option[Role] = byForsyth.get(value.toLower)

  final case class Square(file: Int, rank: Int):
    def key: String = s"${('a' + file).toChar}$rank"

  object Square:
    val all: Vector[Square] = (1 to 10).flatMap(rank => (0 until 9).map(Square(_, rank))).toVector
    private val pattern = "^[a-i](?:10|[1-9])$".r

    def fromKey(value: String): Option[Square] =
      Option.when(pattern.matches(value))(Square(value.head - 'a', value.tail.toInt))

  final case class Piece(side: Side, role: Role)

  final case class Board(pieces: Map[Square, Piece]):
    def pieceAt(square: Square): Option[Piece] = pieces.get(square)
    def pieceAt(square: String): Option[Piece] = Square.fromKey(square).flatMap(pieceAt)

    def material(side: Side): Int =
      pieces.valuesIterator.collect { case Piece(`side`, role) => role.material }.sum

    def materialImbalance(side: Side): Int = material(side) - material(!side)

    def attackingPieces: Int =
      pieces.valuesIterator.count(piece =>
        piece.role == Role.Chariot || piece.role == Role.Cannon || piece.role == Role.Horse
      )

    def developedAttackingPieces: Int =
      Xiangqi.attackerStartingSquares.count: (square, piece) =>
        pieces.get(square).forall(_ != piece)

  final case class PhaseDivision(middle: Option[Int], end: Option[Int], plies: Int)

  private val attackerStartingSquares = Map(
    Square(0, 10) -> Piece(Side.Black, Role.Chariot),
    Square(1, 10) -> Piece(Side.Black, Role.Horse),
    Square(7, 10) -> Piece(Side.Black, Role.Horse),
    Square(8, 10) -> Piece(Side.Black, Role.Chariot),
    Square(1, 8) -> Piece(Side.Black, Role.Cannon),
    Square(7, 8) -> Piece(Side.Black, Role.Cannon),
    Square(0, 1) -> Piece(Side.Red, Role.Chariot),
    Square(1, 1) -> Piece(Side.Red, Role.Horse),
    Square(7, 1) -> Piece(Side.Red, Role.Horse),
    Square(8, 1) -> Piece(Side.Red, Role.Chariot),
    Square(1, 3) -> Piece(Side.Red, Role.Cannon),
    Square(7, 3) -> Piece(Side.Red, Role.Cannon)
  )

  def phaseDivision(boards: Vector[Board]): PhaseDivision =
    val middle = boards.zipWithIndex.collectFirst:
      case (board, ply) if board.attackingPieces <= 10 || board.developedAttackingPieces >= 4 => ply
    val end = middle.flatMap: middlePly =>
      boards.zipWithIndex.collectFirst:
        case (board, ply) if ply > middlePly && board.attackingPieces <= 6 => ply
    PhaseDivision(middle, end, boards.size)

  enum Result(val key: String, val winner: Option[Side]):
    case Ongoing extends Result("*", None)
    case RedWin extends Result("1-0", Some(Side.Red))
    case BlackWin extends Result("0-1", Some(Side.Black))
    case Draw extends Result("1/2-1/2", None)

  object Result:
    def fromKey(value: String): Either[String, Result] =
      Result.values.find(_.key == value).toRight(s"Invalid Xiangqi result: $value")

  /** Awarded points can differ from a played result, for example a double forfeit. */
  enum Score(val value: Float, val show: String):
    case Zero extends Score(0f, "0")
    case Half extends Score(0.5f, "1/2")
    case One extends Score(1f, "1")

  object Score:
    def fromString(value: String): Option[Score] = value match
      case "0" => Some(Zero)
      case "1/2" | "0.5" | "½" => Some(Half)
      case "1" => Some(One)
      case _ => None

  type GamePoints = BySide[Score]

  object GamePoints:
    def fromResult(value: String): Option[GamePoints] = value.split("-", -1) match
      case Array(red, black) =>
        for
          redScore <- Score.fromString(red)
          blackScore <- Score.fromString(black)
        yield BySide(redScore, blackScore)
      case _ => None

    def show(points: Option[GamePoints]): String =
      points.fold("*")(p => s"${p.red.show}-${p.black.show}")

  final case class RecordedResult(points: Option[GamePoints]):
    def key: String = GamePoints.show(points)

  object RecordedResult:
    def fromKey(value: String): Either[String, RecordedResult] =
      if value == "*" then Right(RecordedResult(None))
      else
        GamePoints
          .fromResult(value)
          .map(p => RecordedResult(Some(p)))
          .toRight(s"Invalid recorded Xiangqi result: $value")

  // Standalone analysis/imports are unrestricted unless an actual game's policy is supplied.
  final case class Position(
      initialFen: String = startFen,
      moves: Vector[Uci] = Vector.empty,
      ruleset: Ruleset = Ruleset.Unrestricted
  )
  final case class ExplorerQuery(
      initialFen: String = startFen,
      moves: Vector[Uci] = Vector.empty,
      database: String = "masters",
      player: Option[String] = None,
      color: String = "red",
      since: Option[String] = None,
      until: Option[String] = None
  )
  final case class GamesQuery(
      sources: Vector[String] = Vector("m", "n", "t", "k", "o", "b", "u", "w"),
      search: String = "",
      sort: String = "date",
      direction: String = "desc",
      page: Int = 1,
      pageSize: Int = 100
  )
  final case class CatalogGameQuery(id: String)
  final case class PuzzleQuery(
      theme: String = "centroidPawnMate",
      id: Option[String] = None,
      exclude: Vector[String] = Vector.empty
  )
  final case class MoveCommand(
      initialFen: String = startFen,
      moves: Vector[Uci] = Vector.empty,
      move: Uci,
      ruleset: Ruleset = Ruleset.Unrestricted
  )
  final case class VariationCommand(
      initialFen: String = startFen,
      moves: Vector[Uci] = Vector.empty,
      variation: Vector[Uci],
      ruleset: Ruleset = Ruleset.Unrestricted
  )
  final case class NotationMoveCommand(
      initialFen: String = startFen,
      moves: Vector[Uci] = Vector.empty,
      notation: String,
      ruleset: Ruleset = Ruleset.Unrestricted
  )
  final case class VariationMove(move: Uci, notation: String, chineseNotation: String, state: State)
  final case class VariationResult(moves: Vector[VariationMove])
  final case class AnalysisCommand(
      initialFen: String = startFen,
      moves: Vector[Uci] = Vector.empty,
      moveTimeMs: Int = 900,
      multiPv: Int = 3
  )
  final case class NotationImport(
      initialFen: String = startFen,
      notation: String,
      ruleset: Option[Ruleset] = None
  )
  final case class Ending(ended: Boolean, result: Int)
  final case class State(
      variant: String,
      fen: String,
      ply: Int,
      turn: Side,
      legalMoves: Vector[Uci],
      check: Boolean,
      redInsufficientMaterial: Boolean = false,
      blackInsufficientMaterial: Boolean = false,
      insufficientMaterial: Boolean,
      gameResult: Result,
      immediateEnd: Ending,
      optionalEnd: Ending,
      adjudication: Option[AdjudicationState] = None,
      termination: Option[String] = None,
      variation: Option[String] = None
  ):
    def ended = gameResult != Result.Ongoing
    // Both checkmate and stalemate are board wins with the same mate events.
    def mate = immediateEnd.ended && gameResult.winner.isDefined &&
      termination.exists(reason => reason == "checkmate" || reason == "stalemate")
    def insufficient(side: Side) =
      if side == Side.Red then redInsufficientMaterial else blackInsufficientMaterial

  final case class MoveResult(
      move: Uci,
      notation: String,
      chineseNotation: String,
      capture: Boolean,
      checkmate: Boolean,
      variant: String,
      fen: String,
      ply: Int,
      turn: Side,
      legalMoves: Vector[Uci],
      check: Boolean,
      redInsufficientMaterial: Boolean = false,
      blackInsufficientMaterial: Boolean = false,
      insufficientMaterial: Boolean,
      gameResult: Result,
      immediateEnd: Ending,
      optionalEnd: Ending,
      adjudication: Option[AdjudicationState] = None,
      termination: Option[String] = None,
      variation: Option[String] = None
  ):
    def state = State(
      variant = variant,
      fen = fen,
      ply = ply,
      turn = turn,
      legalMoves = legalMoves,
      check = check,
      redInsufficientMaterial = redInsufficientMaterial,
      blackInsufficientMaterial = blackInsufficientMaterial,
      insufficientMaterial = insufficientMaterial,
      gameResult = gameResult,
      immediateEnd = immediateEnd,
      optionalEnd = optionalEnd,
      adjudication = adjudication,
      termination = termination,
      variation = variation
    )

  /** Canonical immutable state of a native Lixiangqi game.
    *
    * Coordinate moves are the persisted source of truth. WXF notation and the current state are authoritative
    * derivatives returned by the rules boundary for the same line.
    */
  final case class Game(
      initialFen: String,
      moves: Vector[Uci],
      wxf: Vector[String],
      states: Vector[State],
      ruleset: Ruleset = Ruleset.default
  ):
    require(initialFen.nonEmpty, "A Xiangqi game requires an initial FEN")
    require(moves.size == wxf.size, "Every Xiangqi move requires one WXF value")
    require(states.size == moves.size + 1, "A Xiangqi game requires one state per position")
    require(state.ply >= moves.size, "The current Xiangqi ply cannot precede its stored moves")

    def state = states.last

    lazy val chineseWxf: Vector[String] =
      moves
        .zip(states)
        .map: (move, before) =>
          XiangqiRules
            .notation(before.fen, move, NotationStyle.Chinese)
            .fold(error => throw IllegalStateException(error), identity)

    def notations(style: NotationStyle): Vector[String] =
      style match
        case NotationStyle.English => wxf
        case NotationStyle.Chinese => chineseWxf

    def applyMove(result: MoveResult): Either[String, Game] =
      Either.cond(
        result.ply == state.ply + 1 && result.turn == !state.turn,
        copy(moves = moves :+ result.move, wxf = wxf :+ result.notation, states = states :+ result.state),
        s"Invalid Xiangqi transition from ply ${state.ply} to ${result.ply}"
      )

    def position = Position(initialFen, moves, ruleset)

  object Game:
    lazy val initial: Game =
      XiangqiRules.initialGame().fold(error => throw IllegalStateException(error), identity)

    /** A standalone snapshot has no adjudication history. Use XiangqiRules.initialGame for live games. */
    def fromState(initialFen: String, state: State): Either[String, Game] =
      Either.cond(
        initialFen.nonEmpty && state.ply >= 0,
        Game(initialFen, Vector.empty, Vector.empty, Vector(state), Ruleset.Unrestricted),
        "Invalid initial Xiangqi game state"
      )
  final case class LessonValidation(positions: Vector[State], notations: Vector[String])
  final case class EngineScore(
      cp: Option[Int],
      mate: Option[Int],
      redCp: Option[Int],
      redMate: Option[Int],
      bound: Option[String],
      wdl: Option[Vector[Int]]
  )
  final case class EngineLine(
      multipv: Int,
      depth: Int,
      seldepth: Int,
      timeMs: Int,
      nodes: Int,
      nps: Int,
      score: EngineScore,
      pvMoves: Vector[Uci],
      wxfMoves: Vector[String]
  )
  final case class EngineAnalysis(
      engine: String,
      bestMove: Option[Uci],
      depth: Int,
      seldepth: Int,
      timeMs: Int,
      nodes: Int,
      nps: Int,
      score: EngineScore,
      lines: Vector[EngineLine]
  )
  final case class ExplorerMove(
      move: Uci,
      notation: String,
      score: Option[Int],
      rank: Option[Int],
      winrate: Option[Double],
      note: String,
      pvMoves: Vector[Uci],
      wxfMoves: Vector[String]
  )
  final case class ExplorerResult(
      available: Boolean,
      source: String,
      sourceUrl: String,
      moves: Vector[ExplorerMove],
      error: Option[String]
  )
  final case class ImportedTreeNode(
      move: Uci,
      notation: String,
      chineseNotation: String,
      state: State,
      children: Vector[ImportedTreeNode],
      annotations: XiangqiAnnotations.Parsed = XiangqiAnnotations.Parsed(),
      glyphs: Vector[Int] = Vector.empty,
      result: Option[RecordedResult] = None
  )
  final case class ImportedMoveTree(
      initialFen: String,
      headers: Map[String, String],
      state: State,
      children: Vector[ImportedTreeNode],
      annotations: XiangqiAnnotations.Parsed = XiangqiAnnotations.Parsed(),
      glyphs: Vector[Int] = Vector.empty,
      ruleset: Ruleset = Ruleset.Unrestricted
  ):
    def mainline: Game =
      @annotation.tailrec
      def collect(
          children: Vector[ImportedTreeNode],
          moves: Vector[Uci],
          wxf: Vector[String],
          states: Vector[State]
      ): Game =
        children.find(node => !node.annotations.study.exists(_.forceVariation)) match
          case None => Game(initialFen, moves, wxf, states, ruleset)
          case Some(node) =>
            collect(node.children, moves :+ node.move, wxf :+ node.notation, states :+ node.state)
      collect(children, Vector.empty, Vector.empty, Vector(state))
