package lila.xiangqi

import Xiangqi.*
import adjudication.Ruleset

/** Canonical scripted inputs shared by rules tests and Learn. Outcomes belong to the live rules engine. */
object SpecialRulesExamples:
  final case class Example(id: String, initialFen: String, ruleset: Ruleset, moves: Vector[Uci]):
    def at(target: Int): Either[String, Playback] =
      if target < 0 || target > moves.size then Left("Invalid example move index")
      else
        XiangqiRules
          .initialGame(Some(initialFen), ruleset)
          .flatMap: initial =>
            moves
              .take(target)
              .zipWithIndex
              .foldLeft[Either[String, Playback]](Right(Playback(initial, None))):
                case (acc, (move, index)) =>
                  acc.flatMap: playback =>
                    if playback.rejected.isDefined then Right(playback)
                    else
                      XiangqiRules.move(playback.game, move) match
                        case Left(error) =>
                          Right(playback.copy(rejected = Some(Attempt(index + 1, move, error))))
                        case Right(result) => playback.game.applyMove(result).map(Playback(_, None))

    // Unrestricted replay labels even a prohibited attempt, but never supplies a displayed game state.
    lazy val labels: Either[String, Vector[(Uci, String, String)]] =
      XiangqiRules
        .game(Position(initialFen, moves, Ruleset.Unrestricted))
        .map: game =>
          moves.zip(game.wxf).zip(game.chineseWxf).map { case ((move, english), chinese) =>
            (move, english, chinese)
          }

  final case class Attempt(ply: Int, move: Uci, error: String)
  final case class Playback(game: Game, rejected: Option[Attempt])

  val singlePiece = Example(
    id = "single-chariot-check",
    initialFen = "4k4/9/3R5/9/9/4P4/9/9/9/3K5 w - - 0 1",
    ruleset = Ruleset.Tiantian,
    moves = Vector(
      "d8e8",
      "e10f10",
      "e8f8",
      "f10e10",
      "f8e8",
      "e10f10",
      "e8f8",
      "f10e10",
      "f8e8",
      "e10f10",
      "e8f8",
      "f10e10",
      "f8e8"
    ).map(Uci.unsafe)
  )

  val twoPieces = Example(
    id = "two-piece-check",
    initialFen = "4k4/9/8N/5N3/9/4P4/9/9/9/3K5 w - - 0 1",
    ruleset = Ruleset.Tiantian,
    moves = Vector(
      "f7d8",
      "e10e9",
      "d8c10",
      "e9e10",
      "i8g9",
      "e10f10",
      "g9e8",
      "f10e10",
      "c10d8",
      "e10e9",
      "d8c10",
      "e9e10",
      "c10d8",
      "e10e9",
      "d8c10",
      "e9e10",
      "c10d8",
      "e10e9",
      "d8c10",
      "e9e10",
      "c10d8",
      "e10e9",
      "d8c10",
      "e9e10",
      "e8g9"
    ).map(Uci.unsafe)
  )

  val threePieces = Example(
    id = "three-piece-check",
    initialFen = "4k4/9/1C7/7N1/6R2/4P4/9/9/9/3K5 w - - 0 1",
    ruleset = Ruleset.Tiantian,
    moves = Vector(
      "g6e6",
      "e10f10",
      "e6f6",
      "f10e10",
      "h7f8",
      "e10e9",
      "f6e6",
      "e9f9",
      "e6e9",
      "f9f10",
      "e9e10",
      "f10f9",
      "e10e9",
      "f9f10",
      "e9e10",
      "f10f9",
      "e10f10",
      "f9e9",
      "f8d7",
      "e9d9",
      "f10f9",
      "d9d8",
      "f9d9",
      "d8e8",
      "d9d8",
      "e8e9",
      "d8c8",
      "e9d9",
      "c8c9",
      "d9d10",
      "c9c10",
      "d10d9",
      "c10c9",
      "d9d10",
      "c9c10",
      "d10d9",
      "c10c9"
    ).map(Uci.unsafe)
  )

  // Keep scripted inputs together: cross-referencing eagerly initialized registries can deadlock.
  private def ex(id: String, fen: String, moves: Vector[String]) =
    Example(id, fen, Ruleset.Tiantian, moves.map(Uci.unsafe))
  private def line(moves: String*) = moves.toVector
  private val sixChecks = singlePiece.moves.take(12).map(_.value)

  val singleRestart = ex(
    "single-check-restart",
    singlePiece.initialFen,
    sixChecks ++ line("f8f7", "e10e9") ++
      Vector.fill(3)(line("f7e7", "e9f9", "e7f7", "f9e9")).flatten ++ line("f7e7")
  )
  // The same cannon gives all checks. The final horse becomes its screen on e9,
  // where Black's cannon cannot interpose; the rooks cover the general's escapes.
  val singleMate = ex(
    "single-check-mate-exception",
    "4k4/c4R3/6N2/6N2/9/9/3R5/9/9/3KC4 w - - 0 1",
    Vector.fill(3)(line("g7e8", "a9e9", "e8g7", "e9a9")).flatten ++ line("g8e9")
  )
  val checkerCapture = ex(
    "check-capture-restart",
    "4k4/9/3R1p3/9/9/4P4/9/9/9/3K5 w - - 0 1",
    line("d8e8", "e10f10", "e8f8", "f10e10") ++
      Vector.fill(3)(line("f8e8", "e10f10", "e8f8", "f10e10")).flatten ++ line("f8e8")
  )
  val defenderCapture = ex(
    "defender-capture-restart",
    "4kN3/9/3R5/9/9/4P4/9/9/9/3K5 w - - 0 1",
    line("d8e8", "e10f10") ++
      Vector.fill(3)(line("e8f8", "f10e10", "f8e8", "e10f10")).flatten ++ line("e8f8")
  )
  val chase = ex(
    "single-chase",
    "4k4/9/9/9/1n7/4P4/R8/9/9/3K5 w - - 0 1",
    line("a4b4", "b6d7") ++
      Vector.fill(2)(line("b4d4", "d7b6", "d4b4", "b6d7")).flatten ++
      line("b4d4", "d7b6", "d4b4")
  )
  val chaseRestart = ex(
    "chase-restart",
    chase.initialFen,
    chase.moves.take(12).map(_.value) ++ line("d4f4", "b6d7", "f4d4", "d7b6") ++
      Vector.fill(2)(line("d4b4", "b6d7", "b4d4", "d7b6")).flatten ++
      line("d4b4", "b6d7", "b4d4")
  )
  val alternatingSingle = ex(
    "alternating-check-chase-single",
    "4k4/9/2R6/9/1n7/4P4/9/9/9/3K5 w - - 0 1",
    Vector.fill(3)(line("c8e8", "e10f10", "e8b8", "b6c4", "b8f8", "f10e10", "f8c8", "c4b6")).flatten ++
      line("c8e8")
  )
  val alternatingMultiple = ex(
    "alternating-check-chase-multiple",
    "4k4/9/3R5/9/1n7/4P4/R8/9/9/3K5 w - - 0 1",
    line("d8e8", "e10f10", "a4b4", "b6c8") ++
      Vector.fill(4)(line("e8f8", "f10e10", "b4c4", "c8b6", "f8e8", "e10f10", "c4b4", "b6c8")).flatten ++
      line("e8f8")
  )
  val quietRepetition = ex(
    "quiet-repetition",
    startFen,
    Vector.fill(4)(line("b1c3", "b10c8", "c3b1", "c8b10")).flatten
  )

  // Coprime five- and seven-turn routes avoid fivefold repetition before the natural limit.
  private val redQuietRoute = line("a4b4", "b4c4", "c4c5", "c5a5", "a5a4")
  private val blackQuietRoute = line("g7h7", "h7i7", "i7i8", "i8h8", "h8h9", "h9g9", "g9g7")
  private def interleave(red: Vector[String]) =
    red.zipWithIndex.flatMap((move, i) => Vector(move, blackQuietRoute(i % 7)))
  val naturalLimit = ex(
    "natural-move-limit",
    "5k3/9/9/6r2/9/9/R8/9/9/3K5 w - - 0 1",
    interleave(Vector.tabulate(60)(i => redQuietRoute(i % 5)))
  )
  val totalLimit = ex(
    "total-move-limit",
    "5k3/n8/n8/c5r2/c8/9/R8/9/9/3K5 w - - 0 1",
    interleave(
      (Vector(6, 7, 8, 9).flatMap(rank =>
        Vector.fill(9)(redQuietRoute).flatten ++ line(s"a4a$rank", s"a${rank}a4")
      ) ++ Vector.tabulate(12)(i => redQuietRoute(i % 5))).take(200)
    )
  )
  val materialDraw = ex(
    "last-attacker-captured",
    "3k5/9/9/9/9/9/9/9/4p4/4K4 w - - 0 1",
    line("e1e2")
  )
  val mutualChase = ex(
    "mutual-chase",
    "5k3/9/9/r8/9/9/9/8N/4R4/3K5 b - - 0 1",
    line("a7i7", "i3h5", "i7h7", "h5f6", "h7h6", "f6g4", "h6g6", "g4i5", "g6g5", "i5h3", "g5h5", "h3f4")
  )
  // Adapted from AXF 2017 diagram 4, after its opening capture and one countercheck pair.
  // Red begins in check; no earlier checks or capture are counted in this new game.
  val mutualCheck = ex(
    "mutual-check",
    "3akr3/5c3/1P3R3/9/9/9/9/9/9/4CK3 w - - 0 1",
    Vector.fill(3)(line("f8e8", "f9e9", "e8f8", "e9f9")).flatten
  )
  val alternatingRestart = ex(
    "alternating-check-chase-restart",
    alternatingSingle.initialFen,
    alternatingSingle.moves.take(24).map(_.value) ++ line("c8d8", "b6c4", "d8c8", "c4b6") ++
      Vector.fill(2)(line("c8e8", "e10f10", "e8b8", "b6c4", "b8f8", "f10e10", "f8c8", "c4b6")).flatten ++
      line("c8e8", "e10f10", "e8b8", "b6c4", "b8f8", "f10e10", "f8c8")
  )
  val all = Vector(
    singlePiece,
    twoPieces,
    threePieces,
    singleRestart,
    singleMate,
    checkerCapture,
    defenderCapture,
    chase,
    chaseRestart,
    alternatingSingle,
    alternatingMultiple,
    quietRepetition,
    naturalLimit,
    totalLimit,
    materialDraw,
    mutualChase,
    mutualCheck,
    alternatingRestart
  )

  def get(id: String): Option[Example] = all.find(_.id == id)
