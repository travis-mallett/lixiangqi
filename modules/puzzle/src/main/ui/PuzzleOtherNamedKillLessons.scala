package lila.puzzle.ui

import lila.core.i18n.I18nKey.puzzleTheme as i
import lila.puzzle.PuzzleTheme

/** First examples from the Other Basic Kills chapter of the shared source video. Positions and main lines
  * follow the video, including material wins and stalemates.
  */
private[ui] object PuzzleOtherNamedKillLessons:
  val all: List[PuzzleThemeLesson] = List(
    // First example, 3:26:01.
    PuzzleThemeLesson(
      PuzzleTheme.bachelorChariotAttack,
      "t9qar8u6KIQ",
      "1r3a3/4k4/4b4/p8/6b2/2p6/P4R1RP/2r1B4/4A2np/2BAK4 w - - 0 1",
      List(
        "h4h9" -> true,
        "e9e10" -> false,
        "f4f9" -> false,
        "h2f3" -> true,
        "e1f1" -> false,
        "b10b9" -> false,
        "f9b9" -> false,
        "c5b5" -> false,
        "b9f9" -> false,
        "c3c9" -> false,
        "f9c9" -> false,
        "f3h2" -> true,
        "f1e1" -> false,
        "g6i8" -> false,
        "h9d9" -> false,
        "h2f3" -> true,
        "e2f3" -> false,
        "f10e9" -> false,
        "c9c10" -> true,
        "e9d10" -> false,
        "c10d10" -> true
      ),
      i.bachelorChariotAttackLesson,
      i.bachelorChariotAttackFinish,
      videoStartSeconds = 12361
    ),
    // First example, 3:27:30.
    PuzzleThemeLesson(
      PuzzleTheme.boldChariotAttack,
      "t9qar8u6KIQ",
      "r1b1kab2/2cRa4/n1r6/4p3p/4c1p2/2p6/P5P1P/1C2BR1C1/4A4/2BA1K3 w - - 0 1",
      List(
        "d9e9" -> true,
        "f10e9" -> false,
        "h3h10" -> true,
        "e9f10" -> false,
        "f3f10" -> true,
        "e10e9" -> false,
        "b3b9" -> true,
        "e9e8" -> false,
        "f10f8" -> true
      ),
      i.boldChariotAttackLesson,
      i.boldChariotAttackFinish,
      videoStartSeconds = 12450
    ),
    // First example, 3:28:25.
    PuzzleThemeLesson(
      PuzzleTheme.pawnTripleAdvancementAttack,
      "t9qar8u6KIQ",
      "2bak4/4aP3/4b4/5P3/r8/9/P6R1/4B4/4A4/4KAB2 b - - 0 1",
      List(
        "e9f10" -> false,
        "f9f10" -> true,
        "e10f10" -> false,
        "h4h10" -> true,
        "f10f9" -> false,
        "f7f8" -> true,
        "f9e9" -> false,
        "h10h9" -> true,
        "e9e10" -> false,
        "f8f9" -> false,
        "d10e9" -> false,
        "h9h10" -> true,
        "e9f10" -> false,
        "h10f10" -> true
      ),
      i.pawnTripleAdvancementAttackLesson,
      i.pawnTripleAdvancementAttackFinish,
      videoStartSeconds = 12505
    ),
    // First example, 3:29:40.
    PuzzleThemeLesson(
      PuzzleTheme.eunuchChasingEmperorKill,
      "t9qar8u6KIQ",
      "2b6/4k4/1r1abP3/7R1/9/9/9/9/4A4/2BK1A3 w - - 0 1",
      List(
        "h7h9" -> true,
        "e9e10" -> false,
        "f8f9" -> false,
        "e10d10" -> false,
        "f9e9" -> false,
        "e8g10" -> false,
        "h9f9" -> false,
        "b8b6" -> false,
        "f9f10" -> true
      ),
      i.eunuchChasingEmperorKillLesson,
      i.eunuchChasingEmperorKillFinish,
      videoStartSeconds = 12580
    ),
    // First example, 3:30:24.
    PuzzleThemeLesson(
      PuzzleTheme.chariotPawnZugzwang,
      "t9qar8u6KIQ",
      "2bak4/4a4/9/p1p6/6p2/4p4/PN6P/9/4K4/2BA1rr2 b - - 0 1",
      List(
        "g1g2" -> true,
        "e2e3" -> false,
        "e5e4" -> true,
        "e3d3" -> false,
        "f1f3" -> true,
        "c1e3" -> false,
        "e4e3" -> true
      ),
      i.chariotPawnZugzwangLesson,
      i.chariotPawnZugzwangFinish,
      videoStartSeconds = 12624
    ),
    // First example, 3:31:37.
    PuzzleThemeLesson(
      PuzzleTheme.oldPawnSearchingMountain,
      "t9qar8u6KIQ",
      "1P1k2b2/7NC/1c3a3/p6c1/2P1p4/9/2n1C1p2/4B4/4A4/4KAB2 w - - 0 1",
      List(
        "b10c10" -> true
      ),
      i.oldPawnSearchingMountainLesson,
      i.oldPawnSearchingMountainFinish,
      videoStartSeconds = 12697
    ),
    // First example, 3:32:37.
    PuzzleThemeLesson(
      PuzzleTheme.threeImmortalsRefiningTheElixir,
      "t9qar8u6KIQ",
      "3a5/3Pak3/4b1P2/5P3/2b6/9/9/9/9/5K3 w - - 0 1",
      List(
        "f7f8" -> true,
        "f9f10" -> false,
        "f8f9" -> true,
        "f10e10" -> false,
        "g8g9" -> false,
        "e9f8" -> false,
        "g9g10" -> false,
        "d10e9" -> false,
        "f1e1" -> false,
        "c6a8" -> false,
        "e1d1" -> false,
        "a8c6" -> false,
        "g10f10" -> true,
        "e9f10" -> false,
        "d9d10" -> true
      ),
      i.threeImmortalsRefiningTheElixirLesson,
      i.threeImmortalsRefiningTheElixirFinish,
      videoStartSeconds = 12757
    ),
    // First example, 3:33:50.
    PuzzleThemeLesson(
      PuzzleTheme.whiteHorseMate,
      "t9qar8u6KIQ",
      "2b1ka3/4a2N1/2R1b4/9/9/9/9/5R3/9/4K4 w - - 0 1",
      List(
        "f3f10" -> true,
        "e9f10" -> false,
        "h9f8" -> true,
        "e10d10" -> false,
        "c8d8" -> true
      ),
      i.whiteHorseMateLesson,
      i.whiteHorseMateFinish,
      videoStartSeconds = 12830
    ),
    // First example, 3:35:13.
    PuzzleThemeLesson(
      PuzzleTheme.chariotHorseZugzwang,
      "t9qar8u6KIQ",
      "2baka3/1R7/4b4/4R4/4N4/9/9/4B4/5pr2/4K2c1 w - - 0 1",
      List(
        "e7e8" -> true,
        "d10e9" -> false,
        "e6f8" -> true,
        "e10d10" -> false,
        "e8d8" -> true,
        "e9d8" -> false,
        "b9d9" -> true
      ),
      i.chariotHorseZugzwangLesson,
      i.chariotHorseZugzwangFinish,
      videoStartSeconds = 12913
    ),
    // First example, 3:36:24. The source ends after winning a chariot.
    PuzzleThemeLesson(
      PuzzleTheme.cannonChariotDiscoveredAttack,
      "t9qar8u6KIQ",
      "3aka1RC/9/4b4/9/r8/9/9/4B4/4A4/4KA3 w - - 0 1",
      List(
        "h10h6" -> true,
        "f10e9" -> false,
        "h6a6" -> false
      ),
      i.cannonChariotDiscoveredAttackLesson,
      i.cannonChariotDiscoveredAttackFinish,
      videoStartSeconds = 12984
    ),
    // First example, 3:37:15. The source ends after winning a chariot.
    PuzzleThemeLesson(
      PuzzleTheme.detonatingMineAttack,
      "t9qar8u6KIQ",
      "3ak2CR/4a4/9/1r4n2/9/9/9/4B4/4A4/4KA3 w - - 0 1",
      List(
        "h10h7" -> true,
        "e9f10" -> false,
        "h7b7" -> false
      ),
      i.detonatingMineAttackLesson,
      i.detonatingMineAttackFinish,
      videoStartSeconds = 13035
    ),
    // First example, 3:37:54.
    PuzzleThemeLesson(
      PuzzleTheme.headhunterCannonAttack,
      "t9qar8u6KIQ",
      "2bakab2/R8/8N/9/9/9/9/9/9/3KC4 w - - 0 1",
      List(
        "i8g9" -> true
      ),
      i.headhunterCannonAttackLesson,
      i.headhunterCannonAttackFinish,
      videoStartSeconds = 13074
    ),
    // First example, 3:38:54.
    PuzzleThemeLesson(
      PuzzleTheme.childWorshipsBuddha,
      "t9qar8u6KIQ",
      "3rkr3/4a4/4P4/9/9/9/9/9/9/4K4 w - - 0 1",
      List(
        "e8e9" -> true
      ),
      i.childWorshipsBuddhaLesson,
      i.childWorshipsBuddhaFinish,
      videoStartSeconds = 13134
    ),
    // First example, 3:39:21.
    PuzzleThemeLesson(
      PuzzleTheme.servantCrowdingMasterAttack,
      "t9qar8u6KIQ",
      "3aka3/4n4/9/9/9/9/9/9/9/4K2C1 w - - 0 1",
      List(
        "h1h10" -> true
      ),
      i.servantCrowdingMasterAttackLesson,
      i.servantCrowdingMasterAttackFinish,
      videoStartSeconds = 13161
    ),
    // First example, 3:40:05.
    PuzzleThemeLesson(
      PuzzleTheme.stalemateMate,
      "t9qar8u6KIQ",
      "5k3/9/7N1/9/2N6/9/9/9/9/4K4 w - - 0 1",
      List(
        "c6d8" -> false
      ),
      i.stalemateMateLesson,
      i.stalemateMateFinish,
      videoStartSeconds = 13205
    ),
    // First example, 3:40:38.
    PuzzleThemeLesson(
      PuzzleTheme.leisurelyStrollMate,
      "t9qar8u6KIQ",
      "5kbnC/4P4/9/9/9/9/9/9/9/3K5 w - - 0 1",
      List(
        "d1d2" -> false
      ),
      i.leisurelyStrollMateLesson,
      i.leisurelyStrollMateFinish,
      videoStartSeconds = 13238
    ),
    // First example, 3:41:24.
    PuzzleThemeLesson(
      PuzzleTheme.flankingTrioMate,
      "t9qar8u6KIQ",
      "5N2C/3kaR3/4b4/9/9/9/8c/4p1n2/3p5/4KA3 b - - 0 1",
      List(
        "d9d8" -> false,
        "i10i8" -> true,
        "e8g6" -> false,
        "f9f8" -> true,
        "g6e8" -> false,
        "f8e8" -> true
      ),
      i.flankingTrioMateLesson,
      i.flankingTrioMateFinish,
      videoStartSeconds = 13284,
      initialCheck = true
    ),
    // First example, 3:42:20.
    PuzzleThemeLesson(
      PuzzleTheme.drawerMate,
      "t9qar8u6KIQ",
      "3ak1b2/1C2a2R1/1n2b1n2/4p4/9/4C4/9/3RB4/1r2pr3/3K5 w - - 0 1",
      List(
        "b9b10" -> true,
        "b8c10" -> false,
        "h9e9" -> true,
        "e10e9" -> false,
        "d3d9" -> true,
        "e9e10" -> false,
        "d9d10" -> true,
        "e10e9" -> false,
        "d10d9" -> true
      ),
      i.drawerMateLesson,
      i.drawerMateFinish,
      videoStartSeconds = 13340
    ),
    // First example, 3:43:36.
    PuzzleThemeLesson(
      PuzzleTheme.doubleCheckMate,
      "t9qar8u6KIQ",
      "3akab2/9/4b4/9/4N4/4C4/9/9/2nr5/3AKA3 w - - 0 1",
      List(
        "e6f8" -> true
      ),
      i.doubleCheckMateLesson,
      i.doubleCheckMateFinish,
      videoStartSeconds = 13416
    ),
    // First example, 3:44:02.
    PuzzleThemeLesson(
      PuzzleTheme.tripleCheckMate,
      "t9qar8u6KIQ",
      "2bakab2/5PNC1/9/4C4/9/9/9/4B4/4A4/4KAB2 w - - 0 1",
      List(
        "f9e9" -> true
      ),
      i.tripleCheckMateLesson,
      i.tripleCheckMateFinish,
      videoStartSeconds = 13442
    ),
    // First example, 3:44:34.
    PuzzleThemeLesson(
      PuzzleTheme.quadrupleCheckMate,
      "t9qar8u6KIQ",
      "2bakab2/1R3RN2/5N3/4C4/9/9/9/4B4/4A4/4KAB2 w - - 0 1",
      List(
        "f9e9" -> true
      ),
      i.quadrupleCheckMateLesson,
      i.quadrupleCheckMateFinish,
      videoStartSeconds = 13474
    ),
    // First example, 3:45:15. The source ends at the countercheck.
    PuzzleThemeLesson(
      PuzzleTheme.crossCheckAttack,
      "t9qar8u6KIQ",
      "2bak4/C3aRN2/4c4/9/7R1/9/9/2n1C4/4A1rnr/2BAK3c b - - 0 1",
      List(
        "g2g1" -> true,
        "f9f1" -> true
      ),
      i.crossCheckAttackLesson,
      i.crossCheckAttackFinish,
      videoStartSeconds = 13515
    ),
    // First example, 3:45:49.
    PuzzleThemeLesson(
      PuzzleTheme.hidingBehindLeavesAttack,
      "t9qar8u6KIQ",
      "4k4/9/5R3/5P2r/9/n8/9/4BA3/4Ap3/2BKC4 b - - 0 1",
      List(
        "i7i1" -> false,
        "e2f1" -> true,
        "f2e2" -> false,
        "f1e2" -> false,
        "i1i4" -> false,
        "e2f1" -> true,
        "i4e4" -> false,
        "e1e4" -> false,
        "a5c4" -> false,
        "f7e7" -> true,
        "c4e5" -> false,
        "f8f9" -> false
      ),
      i.hidingBehindLeavesAttackLesson,
      i.hidingBehindLeavesAttackFinish,
      videoStartSeconds = 13549
    ),
    // First example, 3:46:39.
    PuzzleThemeLesson(
      PuzzleTheme.generalDisrobingAttack,
      "t9qar8u6KIQ",
      "2Rcka3/4a4/b8/9/6N2/9/9/4B4/9/4K4 w - - 0 1",
      List(
        "e3c1" -> false,
        "a8c10" -> false,
        "g6f8" -> true
      ),
      i.generalDisrobingAttackLesson,
      i.generalDisrobingAttackFinish,
      videoStartSeconds = 13599
    ),
    // First example, 3:47:39. The source ends after winning the second cannon.
    PuzzleThemeLesson(
      PuzzleTheme.assistingKingAttack,
      "t9qar8u6KIQ",
      "2bk5/4P4/3cbc3/5R3/9/9/9/9/9/4K4 w - - 0 1",
      List(
        "e1d1" -> false,
        "c10a8" -> false,
        "f7f8" -> false
      ),
      i.assistingKingAttackLesson,
      i.assistingKingAttackFinish,
      videoStartSeconds = 13659
    )
  )
