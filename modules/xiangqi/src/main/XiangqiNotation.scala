package lila.xiangqi

import scala.collection.mutable

import Xiangqi.*
import lila.xiangqi.adjudication.Ruleset

/** The native notation import boundary. Each variation retains its own immutable game history. */
object XiangqiNotation:

  private val maxCharacters = 500_000
  private val maxNodes = 3_000
  private val maxPlies = 600
  private val maxVariationDepth = 64
  private val moveNumber = "^([0-9]+)\\.(\\.\\.)?".r
  private val suffixGlyphs = Map("!" -> 1, "?" -> 2, "!!" -> 3, "??" -> 4, "!?" -> 5, "?!" -> 6)

  private enum Token:
    case Header(name: String, value: String)
    case Comment(text: String)
    case Word(text: String)
    case Open, Close

  /** Read leading metadata using the same scanner and duplicate checks as full imports. */
  def parseHeaders(text: String): Either[String, Map[String, String]] =
    if text.length > maxCharacters then Left("Notation is too large")
    else tokenize(text).flatMap(tokens => readHeaders(tokens.takeWhile(_.isInstanceOf[Token.Header])))

  /** Split complete games at grammar boundaries, never inside comments or variations. */
  def splitDocuments(text: String, max: Int): Either[String, Vector[String]] =
    if max < 1 then Left("The chapter limit must be positive")
    else if text.length.toLong > maxCharacters.toLong * max then Left("Notation is too large")
    else
      scan(text).flatMap: tokens =>
        val starts = mutable.ArrayBuffer(0)
        var depth = 0
        var movetext = false
        var ended = false
        var error: Option[String] = None
        tokens.foreach: (offset, token) =>
          val newGame = depth == 0 && (token match
            case Token.Header(_, _) => movetext
            case Token.Word(word) => ended && !word.startsWith("$") && !suffixGlyphs.contains(word)
            case _ => false)
          if newGame then
            starts += offset
            movetext = false
            ended = false
          token match
            case Token.Open => depth += 1
            case Token.Close =>
              depth -= 1
              if depth < 0 then error = Some("Unexpected closing variation parenthesis")
            case Token.Word(word) if depth == 0 =>
              movetext = true
              if RecordedResult.fromKey(word).isRight then ended = true
            case _ => ()
        if depth != 0 then error = Some("Unclosed variation parenthesis")
        if starts.size > max then error = Some(s"Notation contains more than $max chapters")
        error.toLeft:
          (starts.toVector :+ text.length)
            .sliding(2)
            .collect:
              case Vector(start, end) if !isEmptyDocument(text.substring(start, end)) =>
                text.substring(start, end).trim
            .toVector

  def importTree(command: NotationImport): Either[String, ImportedMoveTree] =
    if isEmptyDocument(command.notation) then Left("Notation must be a non-empty string")
    else if command.notation.length > maxCharacters then Left("Notation is too large")
    else
      for
        tokens <- tokenize(command.notation)
        headers <- readHeaders(tokens.takeWhile(_.isInstanceOf[Token.Header]))
        _ <- headers.get("variant") match
          case None => Right(())
          case Some(value) =>
            Either.cond(
              GameVariant.values.exists(v => value.equalsIgnoreCase(v.key) || value.equalsIgnoreCase(v.name)),
              (),
              s"Unsupported Variant tag: $value"
            )
        taggedRuleset <- headers.get("ruleset").map(Ruleset.fromKey).sequence
        _ <- Either.cond(
          command.ruleset.isEmpty || taggedRuleset.isEmpty || command.ruleset == taggedRuleset,
          (),
          "The Ruleset tag conflicts with the requested ruleset"
        )
        ruleset = taggedRuleset.orElse(command.ruleset).getOrElse(Ruleset.Unrestricted)
        initialFen = headers
          .getOrElse(
            "fen",
            if command.initialFen == startFen then
              headers
                .get("variant")
                .flatMap(value =>
                  GameVariant.values
                    .find(v => value.equalsIgnoreCase(v.key) || value.equalsIgnoreCase(v.name))
                )
                .fold(command.initialFen)(_.startFen)
            else command.initialFen
          )
          .trim
        root <- XiangqiRules.game(Position(initialFen, ruleset = ruleset))
        _ <- Either.cond(
          headers
            .get("variant")
            .forall(value =>
              value.equalsIgnoreCase(root.variant.key) || value.equalsIgnoreCase(root.variant.name)
            ),
          (),
          "The Variant tag conflicts with the position"
        )
        headerResult <- headers.get("result").map(RecordedResult.fromKey).sequence
        parser = Parser(tokens.dropWhile(_.isInstanceOf[Token.Header]))
        children = mutable.ArrayBuffer.empty[Builder]
        result <- parser.parseSequence(root, children, 0, 0)
        annotations <- XiangqiAnnotations.parse(parser.comments.toVector)
        _ <- Either.cond(annotations.nodeResult.isEmpty, (), "A node result must follow a move")
        nodes <- immutable(children)
        _ <- Either.cond(
          headerResult.isEmpty || result.isEmpty || headerResult == result,
          (),
          "The Result tag conflicts with the movetext result"
        )
      yield ImportedMoveTree(
        initialFen = root.state.fen,
        headers = result.orElse(headerResult).fold(headers)(r => headers.updated("result", r.key)),
        state = root.state,
        children = nodes,
        annotations = annotations,
        glyphs = parser.glyphs.toVector.distinct,
        ruleset = root.ruleset
      )

  /** Stored display labels can predate notation fixes; exports use the recorded move and position. */
  def exportMoves(game: Game): Vector[String] =
    game.moves.zipWithIndex.map: (move, index) =>
      exportMove(game.states(index), move, game.states(index + 1), NotationStyle.English)

  private def exportMove(before: State, move: Uci, after: State, style: NotationStyle): String =
    require(before.legalMoves.contains(move), s"Illegal recorded move: ${move.value}")
    val reveal = after.reveal.map(key =>
      Role.byKey.getOrElse(key, throw IllegalArgumentException(s"Invalid reveal: $key"))
    )
    val transition = XiangqiRules
      .revealedMove(before.fen, move, reveal)
      .fold(error => throw IllegalArgumentException(error), identity)
    require(
      transition.fen == after.fen && transition.ply == after.ply,
      s"Invalid recorded position for ${move.value}"
    )
    XiangqiRules
      .exportNotation(before.fen, move, style)
      .fold(error => throw IllegalArgumentException(error), identity) + after.reveal.fold("")("~" + _)

  /** Render the same native tree grammar accepted by importTree, without interpreting comment data. */
  def exportTree(tree: ImportedMoveTree, style: NotationStyle = NotationStyle.English): String =
    val result = tree.headers.getOrElse("result", tree.mainline.state.gameResult.key)
    val headers = tree.headers ++ Map(
      "variant" -> Fen.board(tree.initialFen).get.variant.name,
      "moveformat" -> (if style == NotationStyle.Chinese then "Chinese" else "WXF"),
      "ruleset" -> tree.ruleset.key,
      "fen" -> tree.initialFen,
      "result" -> result
    )
    def escaped(value: String): String =
      value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r")
    val output = new StringBuilder
    headers.toVector
      .sortBy(_._1)
      .foreach: (name, value) =>
        output.append(s"[$name \"${escaped(value)}\"]\n")
    output.append('\n')

    def annotations(parsed: XiangqiAnnotations.Parsed, glyphs: Vector[Int]): Unit =
      glyphs.foreach(glyph => output.append(s" $$$glyph"))
      XiangqiAnnotations
        .render(parsed)
        .foreach: comment =>
          output.append('\n')
          comment.split("\n", -1).foreach(line => output.append(';').append(line).append('\n'))
          output.append('\n')

    def move(node: ImportedTreeNode, before: State): Unit =
      val number = (node.state.ply + 1) / 2
      val dots = if node.state.ply % 2 == 1 then "." else "..."
      val notation = exportMove(before, node.move, node.state, style)
      output.append(s"$number$dots $notation")
      annotations(node.annotations.copy(nodeResult = node.result), node.glyphs)

    def line(children: Vector[ImportedTreeNode], before: State): Unit = children.headOption.foreach: main =>
      move(main, before)
      children.tail.foreach: variation =>
        output.append(" (")
        move(variation, before)
        if variation.children.nonEmpty then
          output.append(' ')
          line(variation.children, variation.state)
        output.append(')')
      if main.children.nonEmpty then
        output.append(' ')
        line(main.children, main.state)

    annotations(tree.annotations, tree.glyphs)
    line(tree.children, tree.state)
    output.append(' ').append(result).append('\n').result()

  private def readHeaders(tokens: Vector[Token]): Either[String, Map[String, String]] =
    tokens.foldLeft[Either[String, Map[String, String]]](Right(Map.empty)):
      case (acc, Token.Header(name, value)) =>
        acc.flatMap: headers =>
          val key = name.toLowerCase(java.util.Locale.ROOT)
          if headers.contains(key) then Left(s"Duplicate notation header: $name")
          else Right(headers.updated(key, value))
      case (acc, _) => acc

  private final class Builder(result: MoveResult, var depth: Int):
    val move = result.move
    val state = result.state
    val children = mutable.ArrayBuffer.empty[Builder]
    val comments = mutable.ArrayBuffer.empty[String]
    val glyphs = mutable.ArrayBuffer.empty[Int]
    var declaredResult: Option[RecordedResult] = None

    def immutable: Either[String, ImportedTreeNode] =
      for
        annotations <- XiangqiAnnotations.parse(comments.toVector)
        _ <- Either.cond(
          declaredResult.isEmpty || annotations.nodeResult.isEmpty || declaredResult == annotations.nodeResult,
          (),
          "Conflicting node result and variation result"
        )
        nodes <- XiangqiNotation.immutable(children)
      yield ImportedTreeNode(
        move,
        result.notation,
        result.chineseNotation,
        state,
        nodes,
        annotations.copy(nodeResult = None),
        glyphs.toVector.distinct,
        annotations.nodeResult.orElse(declaredResult)
      )

  private def immutable(nodes: mutable.ArrayBuffer[Builder]): Either[String, Vector[ImportedTreeNode]] =
    nodes.foldLeft[Either[String, Vector[ImportedTreeNode]]](Right(Vector.empty)): (result, node) =>
      for
        previous <- result
        next <- node.immutable
      yield previous :+ next

  private final class Parser(tokens: Vector[Token]):
    private var index = 0
    private var nodeCount = 0
    val comments = mutable.ArrayBuffer.empty[String]
    val glyphs = mutable.ArrayBuffer.empty[Int]

    def parseSequence(
        start: Game,
        siblings: mutable.ArrayBuffer[Builder],
        depth: Int,
        initialLength: Int
    ): Either[String, Option[RecordedResult]] =
      if depth > maxVariationDepth then Left("Notation variations are nested too deeply")
      else
        var current = start
        var length = initialLength
        var children = siblings
        var before: Option[Game] = None
        var parent: Option[mutable.ArrayBuffer[Builder]] = None
        var last: Option[Builder] = None
        val leadingComments = mutable.ArrayBuffer.empty[String]
        val leadingGlyphs = mutable.ArrayBuffer.empty[Int]
        var result: Option[RecordedResult] = None
        var error: Option[String] = None
        var closed = false

        def annotate(glyph: Int): Unit =
          last.fold(if depth == 0 then glyphs else leadingGlyphs)(_.glyphs) += glyph

        while index < tokens.size && error.isEmpty && !closed do
          val token = tokens(index)
          index += 1
          token match
            case Token.Header(name, _) => error = Some(s"Header $name appears after movetext")
            case Token.Comment(text) =>
              last.fold(if depth == 0 then comments else leadingComments)(_.comments) += text
            case Token.Close =>
              if depth == 0 then error = Some("Unexpected closing variation parenthesis")
              else if last.isEmpty then error = Some("A variation must contain a move")
              else closed = true
            case Token.Open =>
              (parent, before) match
                case (Some(nodes), Some(game)) if result.isEmpty =>
                  parseSequence(game, nodes, depth + 1, length - 1) match
                    case Left(message) => error = Some(message)
                    case Right(_) => ()
                case _ => error = Some("A variation must follow a move before the result")
            case Token.Word(word) if word.startsWith("$") =>
              word.drop(1).toIntOption.filter(n => n >= 0 && n <= 255) match
                case Some(n) if word.drop(1).forall(_.isDigit) => annotate(n)
                case _ => error = Some(s"Invalid annotation glyph: $word")
            case Token.Word(word) if suffixGlyphs.contains(word) => annotate(suffixGlyphs(word))
            case Token.Word(word) =>
              val numbered = moveNumber.findPrefixMatchOf(word)
              val raw = numbered.fold(word)(m => word.drop(m.end))
              val invalidNumber = numbered.exists: number =>
                number.group(1).toIntOption != Some(current.state.ply / 2 + 1) ||
                  Option(number.group(2)).isDefined != (current.state.turn == Side.Black)
              if invalidNumber then
                error = Some(s"Incorrect move number at ply ${current.state.ply + 1}: $word")
              else if result.nonEmpty then error = Some(s"Unexpected token after result: $word")
              else if raw.nonEmpty then
                RecordedResult.fromKey(raw) match
                  case Right(ending) =>
                    if depth > 0 then
                      last match
                        case Some(node) if node.declaredResult.forall(_ == ending) =>
                          node.declaredResult = Some(ending)
                        case _ => error = Some("Conflicting result in a variation")
                    result = Some(ending)
                  case Left(_) =>
                    val suffix = raw.reverse.takeWhile(c => c == '!' || c == '?').reverse
                    if suffix.nonEmpty && !suffixGlyphs.contains(suffix) then
                      error = Some(s"Invalid move annotation: $suffix")
                    else if length >= maxPlies then
                      error = Some(s"Notation exceeds $maxPlies plies in a branch")
                    else
                      val parts = raw.dropRight(suffix.length).split("~", -1)
                      val next = for
                        _ <- Either.cond(
                          parts.length <= 2 && (current.isJieqi || parts.length == 1),
                          (),
                          "Invalid reveal notation"
                        )
                        uci <- XiangqiRules.resolveNotation(current, parts.head)
                        moved <-
                          if current.isJieqi then Jieqi.analysisMove(current, uci, parts.lift(1))
                          else XiangqiRules.move(current, uci)
                        game <- current.applyMove(moved)
                        node <- merge(children, moved, depth)
                      yield (game, node)
                      next match
                        case Left(message) => error = Some(message)
                        case Right((game, node)) =>
                          node.comments ++= leadingComments
                          node.glyphs ++= leadingGlyphs
                          suffixGlyphs.get(suffix).foreach(node.glyphs += _)
                          leadingComments.clear()
                          leadingGlyphs.clear()
                          before = Some(current)
                          parent = Some(children)
                          current = game
                          children = node.children
                          last = Some(node)
                          length += 1

        if error.isDefined then Left(error.get)
        else if depth > 0 && !closed then Left("Unclosed variation parenthesis")
        else Right(result)

    private def merge(
        nodes: mutable.ArrayBuffer[Builder],
        result: MoveResult,
        depth: Int
    ): Either[String, Builder] =
      nodes.find(node => node.move == result.move && node.state.reveal == result.reveal) match
        case Some(node) if node.state == result.state =>
          node.depth = node.depth.min(depth)
          nodes.sortInPlaceBy(_.depth)
          Right(node)
        case Some(_) => Left(s"Conflicting duplicate move in notation: ${result.move.value}")
        case None =>
          nodeCount += 1
          if nodeCount > maxNodes then Left(s"Notation contains more than $maxNodes moves")
          else
            val node = Builder(result, depth)
            nodes += node
            nodes.sortInPlaceBy(_.depth)
            Right(node)

  private def isEmptyDocument(text: String): Boolean = text.stripPrefix("\uFEFF").trim.isEmpty

  /** Scan headers and comments together so header-looking text inside a comment stays intact. */
  private def tokenize(text: String): Either[String, Vector[Token]] =
    scan(text).map(_.map(_._2))

  private def scan(text: String): Either[String, Vector[(Int, Token)]] =
    val tokens = mutable.ArrayBuffer.empty[(Int, Token)]
    // Skip only the document's encoding marker, retaining original offsets for splitting.
    var index = if text.startsWith("\uFEFF") then 1 else 0
    var tokenStart = 0
    var error: Option[String] = None
    def emit(token: Token): Unit = tokens += tokenStart -> token

    def skipSpace(): Unit = while index < text.length && text(index).isWhitespace do index += 1
    def consume(char: Char): Boolean =
      if index < text.length && text(index) == char then
        index += 1
        true
      else false

    while index < text.length && error.isEmpty do
      skipSpace()
      if index < text.length then
        tokenStart = index
        text(index) match
          case '[' =>
            index += 1
            val start = index
            while index < text.length && (text(index).isLetterOrDigit || text(index) == '_') do index += 1
            val name = text.substring(start, index)
            if name.isEmpty || !name.head.isLetter || index == text.length || !text(index).isWhitespace then
              error = Some(s"Invalid notation header at character $start")
            else
              skipSpace()
              if !consume('"') then error = Some(s"Missing quoted value for header $name")
              else
                val value = new StringBuilder
                var closed = false
                while index < text.length && !closed && error.isEmpty do
                  val char = text(index)
                  index += 1
                  char match
                    case '"' => closed = true
                    case '\\' =>
                      if index >= text.length then error = Some(s"Invalid escape in header $name")
                      else
                        // Decode once: an escaped backslash followed by n or r is literal text.
                        text(index) match
                          case 'n' => value += '\n'
                          case 'r' => value += '\r'
                          case c @ ('\\' | '"') => value += c
                          case _ => error = Some(s"Invalid escape in header $name")
                        index += 1
                    case '\n' | '\r' => error = Some(s"Unclosed value for header $name")
                    case c => value += c
                skipSpace()
                if error.isEmpty then
                  if !closed || !consume(']') then error = Some(s"Unclosed header $name")
                  else emit(Token.Header(name, value.result()))
          case '{' =>
            val start = index + 1
            var depth = 1
            index += 1
            while index < text.length && depth > 0 do
              if text(index) == '{' then depth += 1
              else if text(index) == '}' then depth -= 1
              index += 1
            if depth != 0 then error = Some("Unclosed notation comment")
            else emit(Token.Comment(text.substring(start, index - 1).trim))
          case ';' =>
            val lines = mutable.ArrayBuffer.empty[String]
            var more = true
            while more do
              val start = index + 1
              while index < text.length && text(index) != '\n' && text(index) != '\r' do index += 1
              lines += text.substring(start, index)
              if index < text.length && text(index) == '\r' then index += 1
              if index < text.length && text(index) == '\n' then index += 1
              more = index < text.length && text(index) == ';'
            emit(Token.Comment(lines.mkString("\n").trim))
          case '(' =>
            emit(Token.Open)
            index += 1
          case ')' =>
            emit(Token.Close)
            index += 1
          case '}' => error = Some("Unexpected closing comment brace")
          case _ =>
            val start = index
            index += 1
            while index < text.length && !text(index).isWhitespace && !"(){};[$".contains(text(index)) do
              index += 1
            emit(Token.Word(text.substring(start, index)))
    error.toLeft(tokens.toVector)

  extension [A](value: Option[Either[String, A]])
    private def sequence: Either[String, Option[A]] = value match
      case None => Right(None)
      case Some(result) => result.map(Some(_))
