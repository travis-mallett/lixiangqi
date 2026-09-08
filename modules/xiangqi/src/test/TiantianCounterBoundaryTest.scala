package lila.xiangqi

import Xiangqi.*

/** Explicitly seeded snapshots test large counter boundaries; they are NOT legal replay fixtures. */
class TiantianCounterBoundaryTest extends munit.FunSuite:
  private def initial(fen: String = startFen) = XiangqiRules.initialGame(Some(fen)).fold(fail(_), identity)
  private def play(game: Game, move: String): Game =
    XiangqiRules.move(game, Uci.unsafe(move)).flatMap(game.applyMove).fold(fail(_), identity)
  private def seeded(game: Game, natural: Int = 0, red: Int = 0, black: Int = 0, ply: Int = 0) =
    val numberedFen = game.state.fen.split(' ').updated(5, (ply / 2 + 2).toString).mkString(" ")
    val numbered = XiangqiRules.position(Position(initialFen = numberedFen)).fold(fail(_), identity)
    game.copy(
      moves = Vector.fill(ply)(Uci.unsafe("b1c3")),
      wxf = Vector.fill(ply)("synthetic"),
      states = Vector.fill(ply + 1)(
        game.state.copy(
          fen = numberedFen,
          ply = numbered.ply,
          adjudication =
            game.state.adjudication.map(_.copy(naturalPlies = natural, redChecks = red, blackChecks = black))
        )
      )
    )
  private def mirrorFen(fen: String): String =
    val fields = fen.split(' ')
    val board =
      fields.head.split('/').reverse.map(_.map(c => if c.isUpper then c.toLower else c.toUpper)).mkString("/")
    s"$board ${if fields(1) == "w" then "b" else "w"} ${fields.drop(2).mkString(" ")}"
  private def mirrorUci(move: String): String =
    "([a-i])(10|[1-9])".r.replaceAllIn(move, m => s"${m.group(1)}${11 - m.group(2).toInt}")
  private def colors(fen: String, move: String) =
    Vector((fen, move, Side.Red), (mirrorFen(fen), mirrorUci(move), Side.Black))
  private def counters(game: Game) =
    val a = game.state.adjudication.get
    (a.naturalPlies, a.redChecks, a.blackChecks)

  test("natural counter: 118 to 119 remains ongoing, then 120 draws"):
    val at119 = play(seeded(initial(), natural = 118), "b1c3")
    assert(!at119.state.ended)
    assertEquals(counters(at119), (119, 0, 0))
    val at120 = play(at119, "b10c8")
    assertEquals(counters(at120), (120, 0, 0))
    assertEquals(at120.state.termination, Some("no-capture"))

  test("each side's tenth check counts; its eleventh does not, independently of the opponent"):
    val example = SpecialRulesExamples.singlePiece
    for
      (fen, move, side) <- colors(example.initialFen, example.moves.head.value)
      prior <- Vector(9, 10)
    do
      val root = initial(fen)
      val game = seeded(
        root,
        natural = 118,
        red = if side == Side.Red then prior else 4,
        black = if side == Side.Black then prior else 4
      )
      val next = play(game, move)
      val a = next.state.adjudication.get
      assert(next.state.check)
      assert(!next.state.ended)
      assertEquals(a.naturalPlies, if prior == 9 then 119 else 118)
      assertEquals(a.redChecks, if side == Side.Red then prior + 1 else 4)
      assertEquals(a.blackChecks, if side == Side.Black then prior + 1 else 4)

  test("quiet moves preserve both check allowances; either side's captures reset them"):
    for (fen, move, _) <- colors(SpecialRulesExamples.singlePiece.initialFen, "d8d7") do
      val next = play(seeded(initial(fen), natural = 20, red = 6, black = 7), move)
      assertEquals(counters(next), (21, 6, 7))
    val captureFen = "4k4/9/9/9/9/4P4/9/9/p8/R3K4 w - - 0 1"
    val checkingCaptureFen = "4k4/9/3Rp4/9/9/4P4/9/9/9/3K5 w - - 0 1"
    for
      (source, uci, givesCheck) <- Vector((captureFen, "a1a2", false), (checkingCaptureFen, "d8e8", true))
      (fen, move, _) <- colors(source, uci)
    do
      val next = play(seeded(initial(fen), natural = 119, red = 10, black = 12), move)
      assert(next.state.adjudication.get.fact.get.capture)
      assertEquals(next.state.check, givesCheck)
      assert(!next.state.ended)
      assertEquals(counters(next), (0, 0, 0))

  test("capture prevents a natural draw on ply 399 but cannot reset the total 400-ply limit"):
    val fen = "4k4/9/9/9/9/4P4/9/9/p8/R3K4 w - - 0 1"
    for prior <- Vector(398, 399) do
      val next = play(seeded(initial(fen), natural = 119, ply = prior), "a1a2")
      assert(next.state.adjudication.get.fact.get.capture)
      assertEquals(counters(next), (0, 0, 0))
      assertEquals(next.state.termination, if prior == 399 then Some("move-limit") else None)

  test("mate and stalemate precede natural, total, and coincident move limits, for both colors"):
    for
      (source, uci, reason) <- Vector(
        ("4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1", "a3e3", "checkmate"),
        ("4k4/9/3R1R3/9/9/4P4/9/9/R8/3K5 w - - 0 1", "a2a9", "stalemate")
      )
      (fen, move, side) <- colors(source, uci)
      (natural, ply) <- Vector((119, 0), (0, 399), (119, 399))
    do
      val root = initial(fen)
      assert(!root.state.ended)
      val next = play(seeded(root, natural = natural, ply = ply), move)
      assert(!next.state.adjudication.get.fact.get.capture)
      assertEquals(next.state.termination, Some(reason))
      assertEquals(next.state.check, reason == "checkmate")
      assertEquals(next.state.gameResult, if side == Side.Red then Result.RedWin else Result.BlackWin)

  test("no-attacking-material requires BOTH sides to lack ALL four attacking roles"):
    assertEquals(
      initial("3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1").state.termination,
      Some("no-attacking-material")
    )
    assertEquals(
      initial("3k1a3/4a4/4b4/9/9/9/9/4B4/4A4/3A1K3 w - - 0 1").state.termination,
      Some("no-attacking-material")
    )
    for piece <- "RNCP rncp".filterNot(_ == ' ') do
      assert(
        !initial(s"3k5/9/9/9/9/${piece}8/9/9/9/4K4 w - - 0 1").state.ended,
        s"$piece must prevent material draw"
      )

  test("capturing the last attacking piece draws and preserves the capture identity update"):
    val root = initial("3k5/9/9/9/9/9/9/9/4p4/4K4 w - - 0 1")
    val next = play(root, "e1e2")
    assertEquals(next.state.termination, Some("no-attacking-material"))
    assertEquals(next.state.adjudication.get.identities.get("e2"), Some("e1"))
    assert(!next.state.adjudication.get.identities.values.toSet.contains("e2"))

  test("a draw counter cannot legalize a prohibited check, but a permitted reply can reach a draw"):
    val example = SpecialRulesExamples.singlePiece
    val checked =
      example.moves.take(11).foldLeft(initial(example.initialFen))((game, move) => play(game, move.value))
    def withNatural(n: Int) = checked.copy(states =
      checked.states.init :+ checked.state.copy(
        adjudication = checked.state.adjudication.map(_.copy(naturalPlies = n))
      )
    )
    val restricted = play(withNatural(118), example.moves(11).value)
    assertEquals(restricted.state.adjudication.get.naturalPlies, 119)
    assertEquals(XiangqiRules.move(restricted, example.moves.last), Left("Must vary: perpetual-check"))
    val drawn = play(withNatural(119), example.moves(11).value)
    assertEquals(drawn.state.termination, Some("no-capture"))
    assertEquals(drawn.state.variation, None)

  test("quiet repetition excludes captures, checks, chases, and responses anywhere inside its window"):
    val example = SpecialRulesExamples.quietRepetition
    val before = example.moves.take(15).foldLeft(initial())((game, move) => play(game, move.value))
    assertEquals(play(before, example.moves.last.value).state.termination, Some("repetition"))
    val original = before.states(8).adjudication.get.fact.get
    // Each individual classified-fact mutation isolates the repetition predicate; these are not replays.
    for changed <- Vector(
        original.copy(capture = true),
        original.copy(checkers = Vector("checker")),
        original.copy(chasers = Vector("chaser"), targets = Vector("target")),
        original.copy(responding = true)
      )
    do
      val poisoned = before.copy(states =
        before.states.updated(
          8,
          before
            .states(8)
            .copy(
              adjudication = before.states(8).adjudication.map(_.copy(fact = Some(changed)))
            )
        )
      )
      assert(!play(poisoned, example.moves.last.value).state.ended)
