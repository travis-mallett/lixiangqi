package lila.puzzle.ui

import lila.puzzle.PuzzleTheme
import lila.xiangqi.Xiangqi.{ Fen, Position, Role, Side, Uci }
import lila.xiangqi.XiangqiRules

class PuzzleThemeLessonTest extends munit.FunSuite:
  private val awaitingLessons = Set(PuzzleTheme.threeChariotAttack, PuzzleTheme.smallIronBolt)

  private val basicKills = PuzzleTheme.categorized.head.categories
    .flatMap(_.themes)
    .filterNot(PuzzleTheme.pieceTypeMates.contains)
    .filterNot(awaitingLessons.contains)

  private val materialWins = Map(
    PuzzleTheme.cannonChariotDiscoveredAttack -> Role.Chariot,
    PuzzleTheme.detonatingMineAttack -> Role.Chariot,
    PuzzleTheme.assistingKingAttack -> Role.Cannon
  )
  private val stalemates = Set(
    PuzzleTheme.singleHorseCapturesKing,
    PuzzleTheme.stalemateMate,
    PuzzleTheme.leisurelyStrollMate,
    PuzzleTheme.hidingBehindLeavesAttack
  )

  test("established named kills have lessons; pending, piece-type and other themes do not"):
    basicKills.foreach(theme => assert(PuzzleThemeLesson.find(theme).isDefined, theme.key.value))
    PuzzleTheme.visible
      .filterNot(basicKills.contains)
      .foreach: theme =>
        assertEquals(PuzzleThemeLesson.find(theme), None)

  basicKills.foreach: theme =>
    test(s"${theme.key.value}: legal teaching line, accurate checks, and the source outcome"):
      val lesson = PuzzleThemeLesson.find(theme).getOrElse(fail("Missing lesson"))
      assert(lesson.moves.nonEmpty)
      var position = Position(initialFen = lesson.fen)
      val initial = XiangqiRules.position(position).fold(fail(_), identity)
      assertEquals(initial.check, lesson.initialCheck)
      assertEquals((lesson.playback \ "check").as[Boolean], initial.check)
      lesson.moves.foreach: (move, check) =>
        val before = XiangqiRules.position(position).fold(fail(_), identity)
        val uci = Uci.unsafe(move)
        assert(before.legalMoves.contains(uci), move)
        position = position.copy(moves = position.moves :+ uci)
        val after = XiangqiRules.position(position).fold(fail(_), identity)
        assertEquals(after.check, check, move)
      val result = XiangqiRules.position(position).fold(fail(_), identity)
      materialWins.get(theme) match
        case Some(role) =>
          def enemyCount(fen: String) =
            Fen.board(fen).get.pieces.values.count(p => p.side == Side.Black && p.role == role)
          assertEquals(enemyCount(result.fen), enemyCount(lesson.fen) - 1)
          assert(result.legalMoves.nonEmpty)
          assert(!result.check)
          assert(!result.mate)
        case None if theme == PuzzleTheme.crossCheckAttack =>
          assertEquals(lesson.moves.map(_._2), List(true, true))
          assert(result.check)
          assert(!result.mate)
          assert(result.legalMoves.nonEmpty)
        case None =>
          assert(result.legalMoves.isEmpty)
          assert(result.mate)
          assertEquals(result.check, !stalemates(theme))

  test("chapter videos preserve autoplay and inline playback without an end time"):
    basicKills
      .flatMap(PuzzleThemeLesson.find)
      .foreach: lesson =>
        val uri = java.net.URI.create(lesson.videoEmbedUrl)
        assertEquals(uri.getHost, "www.youtube-nocookie.com")
        assertEquals(uri.getPath, s"/embed/${lesson.videoId}")
        assertEquals(uri.getQuery, s"autoplay=1&playsinline=1&start=${lesson.videoStartSeconds}")
        if lesson.videoId == "t9qar8u6KIQ" then assert(lesson.videoStartSeconds > 0)
