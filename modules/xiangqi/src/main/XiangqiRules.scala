package lila.xiangqi

import scala.collection.mutable
import scala.util.Try
import scala.util.matching.Regex

import lila.xiangqi.Xiangqi.*

/** Native Standard Xiangqi rules and position transitions.
  *
  * Coordinate moves are the authoritative input. Legal move generation, FEN transitions, game termination,
  * and WXF rendering are derived in process so normal Lila game play has no engine or network dependency.
  */
object XiangqiRules:

  final case class Error(message: String) extends RuntimeException(message)

  private case class Decoded(
      board: Board,
      turn: Side,
      halfMove: Int,
      fullMove: Int
  ):
    def ply: Int = (fullMove - 1) * 2 + turn.fold(0, 1)

  private case class Transition(next: Decoded, capture: Boolean)

  extension (side: Side)
    private def fold[A](red: => A, black: => A): A =
      if side == Side.Red then red else black

  def position(input: Position): Either[String, State] =
    replay(input).map(stateOf)

  def initialGame(initialFen: Option[String] = None): Either[String, Game] =
    game(Position(initialFen = normalizedInitialFen(initialFen)))

  def game(input: Position): Either[String, Game] =
    decode(input.initialFen).flatMap: initial =>
      input.moves
        .foldLeft[Either[String, (Game, Decoded)]](
          Right(
            Game(
              initialFen = input.initialFen,
              moves = Vector.empty,
              wxf = Vector.empty,
              states = Vector(stateOf(initial))
            ) -> initial
          )
        ): (result, uci) =>
          result.flatMap: (game, current) =>
            move(current, uci).flatMap: (move, next) =>
              game.applyMove(move).map(_ -> next)
        .map(_._1)

  def move(input: Position, uci: Uci): Either[String, MoveResult] =
    replay(input).flatMap(move(_, uci)).map(_._1)

  /** Apply one move to the current immutable game state.
    *
    * Live games use this overload so move cost is independent of game length. Historical coordinate moves
    * remain available for persistence and repetition adjudication, but are not replayed to validate every new
    * move.
    */
  def move(game: Game, uci: Uci): Either[String, MoveResult] =
    decode(game.state.fen).flatMap(move(_, uci)).map(_._1)

  def legalMoves(fen: String): Either[String, Vector[Uci]] =
    decode(fen).map(legalMoves)

  def wxf(fen: String, uci: Uci): Either[String, String] =
    notation(fen, uci, NotationStyle.English)

  def chinese(fen: String, uci: Uci): Either[String, String] =
    notation(fen, uci, NotationStyle.Chinese)

  def notation(fen: String, uci: Uci, style: NotationStyle): Either[String, String] =
    decode(fen).flatMap: decoded =>
      Try(notation(decoded.board, uci, style)).toEither.left.map(_.getMessage)

  private def normalizedInitialFen(initialFen: Option[String]): String =
    initialFen.map(_.trim).filter(_.nonEmpty).getOrElse(startFen)

  private def replay(input: Position): Either[String, Decoded] =
    input.moves.foldLeft(decode(input.initialFen)): (result, uci) =>
      result.flatMap(current => advance(current, uci).map(_.next))

  private def move(current: Decoded, uci: Uci): Either[String, (MoveResult, Decoded)] =
    advance(current, uci).map: transition =>
      val state = stateOf(transition.next)
      MoveResult(
        move = uci,
        notation = wxf(current.board, uci),
        chineseNotation = chinese(current.board, uci),
        capture = transition.capture,
        checkmate = state.check && state.immediateEnd.ended,
        variant = state.variant,
        fen = state.fen,
        ply = state.ply,
        turn = state.turn,
        legalMoves = state.legalMoves,
        check = state.check,
        redInsufficientMaterial = state.redInsufficientMaterial,
        blackInsufficientMaterial = state.blackInsufficientMaterial,
        insufficientMaterial = state.insufficientMaterial,
        gameResult = state.gameResult,
        immediateEnd = state.immediateEnd,
        optionalEnd = state.optionalEnd
      ) -> transition.next

  private def notation(board: Board, uci: Uci, style: NotationStyle): String =
    style match
      case NotationStyle.English => wxf(board, uci)
      case NotationStyle.Chinese => chinese(board, uci)

  private def advance(current: Decoded, uci: Uci): Either[String, Transition] =
    val illegal = s"Illegal Xiangqi move at ply ${current.ply + 1}: ${uci.value}"
    for
      orig <- Square.fromKey(uci.orig).toRight(illegal)
      dest <- Square.fromKey(uci.dest).toRight(illegal)
      piece <- current.board.pieceAt(orig).toRight(illegal)
      _ <- Either.cond(
        piece.side == current.turn &&
          current.board.pieceAt(dest).forall(_.side != piece.side) &&
          pseudoMoves(current.board, orig, piece).contains(dest) &&
          leavesGeneralSafe(current, orig, dest, piece),
        (),
        illegal
      )
    yield Transition(
      next = applyUnchecked(current, orig, dest, piece),
      capture = current.board.pieceAt(dest).isDefined
    )

  private def decode(fen: String): Either[String, Decoded] =
    if !Fen.isValid(fen) then Left("Invalid Xiangqi FEN")
    else
      val fields = fen.trim.split("\\s+")
      for
        board <- Fen.board(fen).toRight("Invalid Xiangqi board")
        turn <-
          fields(1) match
            case "w" => Right(Side.Red)
            case "b" => Right(Side.Black)
            case _ => Left("Invalid Xiangqi side to move")
        halfMove <- fields(4).toIntOption.toRight("Invalid Xiangqi halfmove number")
        fullMove <- fields(5).toIntOption.toRight("Invalid Xiangqi fullmove number")
      yield Decoded(board, turn, halfMove, fullMove)

  private def stateOf(position: Decoded): State =
    val moves = legalMoves(position)
    val check = attacked(position.board, generalSquare(position.board, position.turn), !position.turn)
    val ended = moves.isEmpty
    val result =
      if !ended then Result.Ongoing
      else if position.turn == Side.Red then Result.BlackWin
      else Result.RedWin
    State(
      variant = "xiangqi",
      fen = encode(position),
      ply = position.ply,
      turn = position.turn,
      legalMoves = moves,
      check = check,
      redInsufficientMaterial = false,
      blackInsufficientMaterial = false,
      insufficientMaterial = false,
      gameResult = result,
      immediateEnd = Ending(ended = ended, result = if ended then 1 else 0),
      optionalEnd = Ending(ended = false, result = 0)
    )

  private def legalMoves(position: Decoded): Vector[Uci] =
    position.board.pieces.iterator
      .collect:
        case (orig, piece) if piece.side == position.turn =>
          pseudoMoves(position.board, orig, piece).iterator
            .filter: dest =>
              position.board.pieceAt(dest).forall(_.side != piece.side) &&
                leavesGeneralSafe(position, orig, dest, piece)
            .map(dest => Uci.unsafe(s"${squareKey(orig)}${squareKey(dest)}"))
      .flatten
      .toVector
      .sortBy(_.value)

  private def leavesGeneralSafe(position: Decoded, orig: Square, dest: Square, piece: Piece): Boolean =
    val moved = position.board.copy(pieces = position.board.pieces - orig + (dest -> piece))
    generalSquare(moved, piece.side).exists(square => !attacked(moved, Some(square), !piece.side))

  private def attacked(board: Board, target: Option[Square], by: Side): Boolean =
    target.exists: square =>
      board.pieces.iterator.exists:
        case (orig, piece) =>
          piece.side == by && pseudoMoves(board, orig, piece, attacksOnly = true).contains(square)

  private def generalSquare(board: Board, side: Side): Option[Square] =
    board.pieces.collectFirst:
      case (square, Piece(`side`, Role.General)) => square

  private def pseudoMoves(
      board: Board,
      orig: Square,
      piece: Piece,
      attacksOnly: Boolean = false
  ): Vector[Square] =
    piece.role match
      case Role.General =>
        val steps = orthogonal.iterator
          .map((dx, dy) => Square(orig.file + dx, orig.rank + dy))
          .filter(onBoard)
          .filter(inPalace(_, piece.side))
          .filter(board.pieceAt(_).forall(_.side != piece.side))
          .toVector
        val flying =
          ray(orig, 0, piece.side.fold(1, -1))
            .dropWhile(board.pieceAt(_).isEmpty)
            .headOption
            .filter: square =>
              board.pieceAt(square).exists(p => p.side != piece.side && p.role == Role.General)
            .toVector
        steps ++ flying
      case Role.Advisor =>
        diagonal.iterator
          .map((dx, dy) => Square(orig.file + dx, orig.rank + dy))
          .filter(onBoard)
          .filter(inPalace(_, piece.side))
          .filter(board.pieceAt(_).forall(_.side != piece.side))
          .toVector
      case Role.Elephant =>
        diagonal.iterator
          .map((dx, dy) =>
            Square(orig.file + dx * 2, orig.rank + dy * 2) ->
              Square(orig.file + dx, orig.rank + dy)
          )
          .filter((dest, eye) =>
            onBoard(dest) &&
              piece.side.fold(dest.rank <= 5, dest.rank >= 6) &&
              board.pieceAt(eye).isEmpty &&
              board.pieceAt(dest).forall(_.side != piece.side)
          )
          .map(_._1)
          .toVector
      case Role.Horse =>
        horseSteps.iterator
          .map: (dx, dy) =>
            val leg =
              if math.abs(dx) == 2 then Square(orig.file + math.signum(dx), orig.rank)
              else Square(orig.file, orig.rank + math.signum(dy))
            Square(orig.file + dx, orig.rank + dy) -> leg
          .filter((dest, leg) =>
            onBoard(dest) &&
              board.pieceAt(leg).isEmpty &&
              board.pieceAt(dest).forall(_.side != piece.side)
          )
          .map(_._1)
          .toVector
      case Role.Chariot =>
        sliding(board, orig, piece.side, cannon = false, attacksOnly)
      case Role.Cannon =>
        sliding(board, orig, piece.side, cannon = true, attacksOnly)
      case Role.Soldier =>
        val forward = piece.side.fold(1, -1)
        val crossedRiver = piece.side.fold(orig.rank >= 6, orig.rank <= 5)
        ((0, forward) +: crossedRiver.option(Vector((-1, 0), (1, 0))).getOrElse(Vector.empty)).iterator
          .map((dx, dy) => Square(orig.file + dx, orig.rank + dy))
          .filter(onBoard)
          .filter(board.pieceAt(_).forall(_.side != piece.side))
          .toVector

  private def sliding(
      board: Board,
      orig: Square,
      side: Side,
      cannon: Boolean,
      attacksOnly: Boolean
  ): Vector[Square] =
    orthogonal.flatMap: (dx, dy) =>
      val squares = ray(orig, dx, dy)
      if !cannon then
        squares.takeWhile(board.pieceAt(_).isEmpty) ++
          squares
            .dropWhile(board.pieceAt(_).isEmpty)
            .headOption
            .filter(board.pieceAt(_).exists(_.side != side))
      else
        val beforeScreen = squares.takeWhile(board.pieceAt(_).isEmpty)
        val afterScreen = squares.drop(beforeScreen.size + 1)
        val capture = afterScreen
          .dropWhile(board.pieceAt(_).isEmpty)
          .headOption
          .filter(board.pieceAt(_).exists(_.side != side))
        if attacksOnly then capture.toVector else beforeScreen ++ capture

  private def ray(orig: Square, dx: Int, dy: Int): Vector[Square] =
    Iterator
      .iterate(Square(orig.file + dx, orig.rank + dy))(s => Square(s.file + dx, s.rank + dy))
      .takeWhile(onBoard)
      .toVector

  private def applyUnchecked(position: Decoded, orig: Square, dest: Square, piece: Piece): Decoded =
    Decoded(
      board = position.board.copy(pieces = position.board.pieces - orig + (dest -> piece)),
      turn = !position.turn,
      halfMove = if position.board.pieceAt(dest).isDefined then 0 else position.halfMove + 1,
      fullMove = position.fullMove + position.turn.fold(0, 1)
    )

  private def encode(position: Decoded): String =
    val ranks = (10 to 1 by -1).map: rank =>
      val encoded = StringBuilder()
      var empty = 0
      (0 until 9).foreach: file =>
        position.board.pieceAt(Square(file, rank)) match
          case None => empty += 1
          case Some(piece) =>
            if empty > 0 then
              encoded.append(empty)
              empty = 0
            val char = piece.role.forsyth
            encoded.append(if piece.side == Side.Red then char.toUpper else char)
      if empty > 0 then encoded.append(empty)
      encoded.result()
    val turn = position.turn.fold("w", "b")
    s"${ranks.mkString("/")} $turn - - ${position.halfMove} ${position.fullMove}"

  private def wxf(board: Board, uci: Uci): String =
    val orig = Square.fromKey(uci.orig).getOrElse(throw Error(s"Invalid Xiangqi origin: ${uci.orig}"))
    val dest = Square.fromKey(uci.dest).getOrElse(throw Error(s"Invalid Xiangqi destination: ${uci.dest}"))
    val piece = board.pieceAt(orig).getOrElse(throw Error(s"No Xiangqi piece at ${uci.orig}"))
    val red = piece.side == Side.Red
    val roleSymbol =
      piece.role match
        case Role.General => "K"
        case Role.Advisor => "A"
        case Role.Elephant => "E"
        case Role.Horse => "H"
        case Role.Chariot => "R"
        case Role.Cannon => "C"
        case Role.Soldier => "P"
    val roleName = if red then roleSymbol else roleSymbol.toLowerCase
    val sameFile = board.pieces.iterator
      .collect:
        case (square, candidate) if square.file == orig.file && candidate == piece => square
      .toVector
      .sortBy(_.rank)(using if red then Ordering.Int.reverse else Ordering.Int)
    val subject =
      if sameFile.size == 2 then
        val frontOrRear = if orig == sameFile.head then "+" else "-"
        s"$frontOrRear$roleName"
      else if sameFile.size >= 3 && piece.role == Role.Soldier then
        s"${sameFile.indexOf(orig) + 1}${fileNumber(orig.file, red)}"
      else s"$roleName${fileNumber(orig.file, red)}"
    val forward = if red then dest.rank > orig.rank else dest.rank < orig.rank
    val (action, target) =
      if dest.rank == orig.rank then "=" -> fileNumber(dest.file, red)
      else if Set(Role.Horse, Role.Elephant, Role.Advisor)(piece.role) then
        (if forward then "+" else "-") -> fileNumber(dest.file, red)
      else (if forward then "+" else "-") -> math.abs(dest.rank - orig.rank)
    s"$subject$action$target"

  private def chinese(board: Board, uci: Uci): String =
    val orig = Square.fromKey(uci.orig).getOrElse(throw Error(s"Invalid Xiangqi origin: ${uci.orig}"))
    val dest = Square.fromKey(uci.dest).getOrElse(throw Error(s"Invalid Xiangqi destination: ${uci.dest}"))
    val piece = board.pieceAt(orig).getOrElse(throw Error(s"No Xiangqi piece at ${uci.orig}"))
    val red = piece.side == Side.Red
    val pieceName =
      (piece.side, piece.role) match
        case (Side.Red, Role.General) => "帅"
        case (Side.Red, Role.Advisor) => "仕"
        case (Side.Red, Role.Elephant) => "相"
        case (Side.Red, Role.Horse) => "马"
        case (Side.Red, Role.Chariot) => "车"
        case (Side.Red, Role.Cannon) => "炮"
        case (Side.Red, Role.Soldier) => "兵"
        case (Side.Black, Role.General) => "将"
        case (Side.Black, Role.Advisor) => "士"
        case (Side.Black, Role.Elephant) => "象"
        case (Side.Black, Role.Horse) => "马"
        case (Side.Black, Role.Chariot) => "车"
        case (Side.Black, Role.Cannon) => "砲"
        case (Side.Black, Role.Soldier) => "卒"
    val sameFile = board.pieces.iterator
      .collect:
        case (square, candidate) if square.file == orig.file && candidate == piece => square
      .toVector
      .sortBy(_.rank)(using if red then Ordering.Int.reverse else Ordering.Int)
    val subject =
      sameFile.size match
        case 1 => s"$pieceName${chineseNumber(fileNumber(orig.file, red), red)}"
        case 2 => s"${if orig == sameFile.head then "前" else "后"}$pieceName"
        case 3 if piece.role == Role.Soldier =>
          s"${Vector("前", "中", "后")(sameFile.indexOf(orig))}$pieceName"
        case _ if piece.role == Role.Soldier =>
          s"${chineseNumber(sameFile.indexOf(orig) + 1, red)}$pieceName"
        case _ => throw Error(s"Cannot disambiguate Chinese notation for ${uci.value}")
    val forward = if red then dest.rank > orig.rank else dest.rank < orig.rank
    val (action, target) =
      if dest.rank == orig.rank then "平" -> fileNumber(dest.file, red)
      else if Set(Role.Horse, Role.Elephant, Role.Advisor)(piece.role) then
        (if forward then "进" else "退") -> fileNumber(dest.file, red)
      else (if forward then "进" else "退") -> math.abs(dest.rank - orig.rank)
    s"$subject$action${chineseNumber(target, red)}"

  private def chineseNumber(number: Int, red: Boolean): String =
    if red then Vector("一", "二", "三", "四", "五", "六", "七", "八", "九")(number - 1)
    else number.toString

  private def fileNumber(file: Int, red: Boolean): Int =
    if red then 9 - file else file + 1

  private def squareKey(square: Square): String =
    s"${('a' + square.file).toChar}${square.rank}"

  private def onBoard(square: Square): Boolean =
    square.file >= 0 && square.file < 9 && square.rank >= 1 && square.rank <= 10

  private def inPalace(square: Square, side: Side): Boolean =
    square.file >= 3 && square.file <= 5 &&
      side.fold(square.rank >= 1 && square.rank <= 3, square.rank >= 8 && square.rank <= 10)

  private val orthogonal = Vector((1, 0), (-1, 0), (0, 1), (0, -1))
  private val diagonal = Vector((1, 1), (1, -1), (-1, 1), (-1, -1))
  private val horseSteps =
    Vector((1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2))

  extension (value: Boolean)
    private def option[A](ifTrue: => A): Option[A] = if value then Some(ifTrue) else None

  object Lesson:
    private val pieceLimits =
      Map(
        Role.General -> 1,
        Role.Advisor -> 2,
        Role.Elephant -> 2,
        Role.Horse -> 2,
        Role.Chariot -> 2,
        Role.Cannon -> 2,
        Role.Soldier -> 5
      )
    private val redAdvisorPoints = Set("d1", "f1", "e2", "d3", "f3")
    private val blackAdvisorPoints = Set("d10", "f10", "e9", "d8", "f8")
    private val redElephantPoints = Set("c1", "g1", "a3", "e3", "i3", "c5", "g5")
    private val blackElephantPoints = Set("c10", "g10", "a8", "e8", "i8", "c6", "g6")

    def validate(input: Position): Either[String, LessonValidation] =
      for
        initial <- decode(input.initialFen)
        _ <- validatePlacement(initial.board)
        _ <- rejectOtherSideInCheck(initial)
        result <- input.moves.zipWithIndex.foldLeft[
          Either[String, (Decoded, Vector[State], Vector[String])]
        ](Right((initial, Vector(stateOf(initial)), Vector.empty))):
          case (acc, (uci, index)) =>
            acc.flatMap: (current, positions, notations) =>
              if !legalMoves(current).contains(uci) then
                Left(s"Illegal Xiangqi lesson move at step ${index + 1}: ${uci.value}")
              else
                for
                  orig <- Square.fromKey(uci.orig).toRight(s"Invalid Xiangqi origin: ${uci.orig}")
                  dest <- Square.fromKey(uci.dest).toRight(s"Invalid Xiangqi destination: ${uci.dest}")
                  piece <- current.board.pieceAt(orig).toRight(s"No Xiangqi piece at ${uci.orig}")
                  notation = wxf(current.board, uci)
                  moved = applyUnchecked(current, orig, dest, piece)
                  _ <- validatePlacement(moved.board)
                  isLast = index == input.moves.size - 1
                  _ <-
                    Either.cond(
                      isLast || !stateOf(moved).check,
                      (),
                      s"Lesson step ${index + 1} gives check, so the opponent's reply cannot be skipped"
                    )
                  next =
                    if isLast then moved
                    else moved.copy(turn = initial.turn)
                  _ <- rejectOtherSideInCheck(next)
                yield (next, positions :+ stateOf(next), notations :+ notation)
      yield LessonValidation(result._2, result._3)

    private def rejectOtherSideInCheck(position: Decoded): Either[String, Unit] =
      val other = !position.turn
      Either.cond(
        !attacked(position.board, generalSquare(position.board, other), position.turn),
        (),
        "The side not to move is already in check"
      )

    private def validatePlacement(board: Board): Either[String, Unit] =
      val counts = board.pieces.values.groupMapReduce(piece => piece.side -> piece.role)(_ => 1)(_ + _)
      for
        _ <- Side.values.foldLeft[Either[String, Unit]](Right(())): (result, side) =>
          result.flatMap: _ =>
            val color = if side == Side.Red then "Red" else "Black"
            for
              _ <- Either.cond(
                counts.getOrElse(side -> Role.General, 0) == 1,
                (),
                "A lesson position must contain exactly one General per side"
              )
              _ <- pieceLimits.foldLeft[Either[String, Unit]](Right(())):
                case (limitResult, (role, limit)) =>
                  limitResult.flatMap: _ =>
                    Either.cond(
                      counts.getOrElse(side -> role, 0) <= limit,
                      (),
                      s"$color has too many ${role.key.toUpperCase} pieces"
                    )
            yield ()
        _ <- board.pieces.foldLeft[Either[String, Unit]](Right(())):
          case (result, (square, piece)) =>
            result.flatMap(_ => validateReachable(square, piece))
        _ <-
          val red = generalSquare(board, Side.Red)
          val black = generalSquare(board, Side.Black)
          val face = for
            r <- red
            b <- black
            if r.file == b.file
          yield (math.min(r.rank, b.rank) + 1 until math.max(r.rank, b.rank))
            .forall(rank => board.pieceAt(Square(r.file, rank)).isEmpty)
          Either.cond(!face.contains(true), (), "The Generals face each other on an open file")
      yield ()

    private def validateReachable(square: Square, piece: Piece): Either[String, Unit] =
      val key = squareKey(square)
      val color = if piece.side == Side.Red then "Red" else "Black"
      piece.role match
        case Role.General =>
          Either.cond(inPalace(square, piece.side), (), s"$color General is outside its palace at $key")
        case Role.Advisor =>
          val points = if piece.side == Side.Red then redAdvisorPoints else blackAdvisorPoints
          Either.cond(points(key), (), s"$color Advisor cannot reach $key")
        case Role.Elephant =>
          val points = if piece.side == Side.Red then redElephantPoints else blackElephantPoints
          Either.cond(points(key), (), s"$color Elephant cannot reach $key")
        case Role.Soldier =>
          val reachable =
            if piece.side == Side.Red then square.rank >= 4 && (square.rank >= 6 || square.file % 2 == 0)
            else square.rank <= 7 && (square.rank <= 5 || square.file % 2 == 0)
          Either.cond(reachable, (), s"$color Soldier cannot reach $key")
        case _ => Right(())

  object Notation:
    private val tagPattern: Regex =
      """(?m)^\s*\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\s*\]\s*$""".r
    private val moveNumberPattern: Regex = """^\d+\.(?:\.\.)?""".r
    private val resultTokens = Set("*", "1-0", "0-1", "1/2-1/2")
    private val maxNodes = 2000
    private val maxDepth = 64

    def importTree(command: NotationImport): Either[String, ImportedMoveTree] =
      val text = command.notation
      if text.trim.isEmpty then Left("notation must be a non-empty string")
      else if text.length > 500000 then Left("notation is too large")
      else
        val headers = tagPattern
          .findAllMatchIn(text)
          .map(m => m.group(1).toLowerCase -> unescape(m.group(2)))
          .toMap
        val variant = headers.getOrElse("variant", "xiangqi").toLowerCase.replace(" ", "")
        if !Set("xiangqi", "standardxiangqi")(variant) then
          Left(s"Unsupported Variant tag: ${headers.getOrElse("variant", "")}")
        else
          val initialFen = headers.getOrElse("fen", command.initialFen).trim
          for
            root <- decode(initialFen)
            stripped <- stripComments(tagPattern.replaceAllIn(text, " "))
            tokens = """\(|\)|[^\s()]+""".r.findAllIn(stripped).toVector
            parser = Parser(tokens)
            roots = mutable.ArrayBuffer.empty[Parser.Node]
            _ <- parser.parseSequence(root, roots, depth = 0, expectClose = false)
            _ <- Either.cond(parser.nodeCount > 0, (), "notation contains no Xiangqi moves")
          yield ImportedMoveTree(initialFen, headers, stateOf(root), roots.map(_.immutable).toVector)

    private object Parser:
      final class Node(
          val move: Uci,
          val notation: String,
          val chineseNotation: String,
          val state: State,
          val children: mutable.ArrayBuffer[Node] = mutable.ArrayBuffer.empty
      ):
        def immutable: ImportedTreeNode =
          ImportedTreeNode(move, notation, chineseNotation, state, children.map(_.immutable).toVector)

    private final class Parser(tokens: Vector[String]):
      import Parser.Node

      var index = 0
      var nodeCount = 0

      def parseSequence(
          start: Decoded,
          siblings: mutable.ArrayBuffer[Node],
          depth: Int,
          expectClose: Boolean
      ): Either[String, Unit] =
        if depth > maxDepth then Left("Notation variations are nested too deeply")
        else
          var current = start
          var currentChildren = siblings
          var lastParent: Option[mutable.ArrayBuffer[Node]] = None
          var lastBefore: Option[Decoded] = None
          var error: Option[String] = None
          var closed = false

          while index < tokens.size && error.isEmpty && !closed do
            tokens(index) match
              case ")" =>
                if !expectClose then error = Some("Unexpected closing variation parenthesis")
                else
                  index += 1
                  closed = true
              case "(" =>
                (lastParent, lastBefore) match
                  case (Some(parent), Some(before)) =>
                    index += 1
                    parseSequence(before, parent, depth + 1, expectClose = true) match
                      case Left(message) => error = Some(message)
                      case Right(_) => ()
                  case _ => error = Some("Variation must follow a move")
              case raw =>
                index += 1
                moveToken(raw).foreach: token =>
                  resolveMove(current, token) match
                    case Left(message) => error = Some(message)
                    case Right(uci) =>
                      val before = current
                      move(Position(currentFen(current)), uci) match
                        case Left(message) => error = Some(message)
                        case Right(result) =>
                          decode(result.fen) match
                            case Left(message) => error = Some(message)
                            case Right(next) =>
                              val node =
                                Node(uci, result.notation, result.chineseNotation, result.state)
                              mergeNode(currentChildren, node) match
                                case Left(message) => error = Some(message)
                                case Right(existing) =>
                                  lastParent = Some(currentChildren)
                                  lastBefore = Some(before)
                                  currentChildren = existing.children
                                  current = next

          if error.isDefined then Left(error.get)
          else if expectClose && !closed then Left("Unclosed variation parenthesis")
          else Right(())

      private def mergeNode(
          nodes: mutable.ArrayBuffer[Node],
          node: Node
      ): Either[String, Node] =
        nodes.indexWhere(_.move == node.move) match
          case -1 =>
            nodeCount += 1
            if nodeCount > maxNodes then return Left("Notation contains too many moves")
            nodes += node
            Right(node)
          case found if nodes(found).state.fen == node.state.fen => Right(nodes(found))
          case _ => Left(s"Conflicting duplicate move in notation: ${node.move.value}")

      private def resolveMove(position: Decoded, token: String): Either[String, Uci] =
        Uci.from(token) match
          case Right(uci) if legalMoves(position).contains(uci) => Right(uci)
          case Right(_) => Left(s"Illegal Xiangqi move at ply ${position.ply + 1}: $token")
          case Left(_) =>
            val matching = legalMoves(position).filter: uci =>
              wxf(position.board, uci) == token || chinese(position.board, uci) == token
            matching match
              case Vector(single) => Right(single)
              case Vector() => Left(s"Unknown or illegal Xiangqi notation at ply ${position.ply + 1}: $token")
              case _ => Left(s"Ambiguous Xiangqi notation at ply ${position.ply + 1}: $token")

    private def currentFen(position: Decoded): String = encode(position)

    private def moveToken(raw: String): Option[String] =
      val token = moveNumberPattern.replaceFirstIn(raw.trim, "")
      Option(token)
        .filter(_.nonEmpty)
        .filterNot(resultTokens)
        .filterNot(_.startsWith("$"))
        .map(_.replaceAll("[!?]+$", ""))

    private def unescape(value: String): String =
      value.replace("\\\"", "\"").replace("\\\\", "\\")

    private def stripComments(text: String): Either[String, String] =
      val output = StringBuilder()
      var braceDepth = 0
      var lineComment = false
      text.foreach: char =>
        if lineComment then
          if char == '\r' || char == '\n' then
            lineComment = false
            output.append(' ')
        else if braceDepth > 0 then
          if char == '{' then braceDepth += 1
          else if char == '}' then braceDepth -= 1
        else if char == '{' then
          braceDepth = 1
          output.append(' ')
        else if char == ';' then
          lineComment = true
          output.append(' ')
        else output.append(char)
      Either.cond(braceDepth == 0, output.result(), "Unclosed notation comment")
