package lila.puzzle.ui

import play.api.libs.json.Json

import lila.core.i18n.I18nKey
import lila.core.i18n.I18nKey.puzzleTheme as i
import lila.puzzle.PuzzleTheme

/** Lesson content lives here; every lesson uses the same markup, styles and browser controller. */
private[ui] case class PuzzleThemeLesson(
    theme: PuzzleTheme,
    videoId: String,
    fen: String,
    moves: List[(String, Boolean)],
    pattern: I18nKey,
    finish: I18nKey,
    videoStartSeconds: Int = 0,
    initialCheck: Boolean = false
):
  val videoEmbedUrl =
    s"https://www.youtube-nocookie.com/embed/$videoId?autoplay=1&playsinline=1&start=$videoStartSeconds"

  // Explicit check flags also support teaching lines containing quiet moves.
  val playback = Json.obj(
    "fen" -> fen,
    "check" -> initialCheck,
    "moves" -> moves.map { (uci, check) => Json.obj("uci" -> uci, "check" -> check) }
  )

private[ui] object PuzzleThemeLesson:
  private val all = (List(
    // First example, 0:07–1:12.
    PuzzleThemeLesson(
      PuzzleTheme.doubleChariotsMate,
      "7N5Lvgdqcpk",
      "2b1k4/9/r8/9/6b2/9/1R2r4/B2A1A3/7R1/5KB2 w - - 0 1",
      List("h2h10" -> true, "e10e9" -> false, "b4b9" -> true, "e9e8" -> false, "h10h8" -> true),
      i.doubleChariotsMateLesson,
      i.doubleChariotsMateFinish
    ),
    // First example, 0:00–1:00. The red general pins the surviving advisor on e9.
    PuzzleThemeLesson(
      PuzzleTheme.throatCuttingMate,
      "VfwgGApX2mY",
      "3ak4/4aR3/9/9/9/2R6/9/3p1p3/3r1r3/4K4 w - - 0 1",
      List("f9e9" -> true, "d10e9" -> false, "c5c10" -> true),
      i.throatCuttingMateLesson,
      i.throatCuttingMateFinish
    ),
    // Small throat-cutting chapter, 16:12–16:51; first position at 16:15.
    PuzzleThemeLesson(
      PuzzleTheme.smallThroatCuttingMate,
      "t9qar8u6KIQ",
      "1Cbak4/3PaP3/4b4/9/9/9/9/9/9/4K4 w - - 0 1",
      List("d9e9" -> true),
      i.smallThroatCuttingMateLesson,
      i.smallThroatCuttingMateFinish,
      videoStartSeconds = 972
    ),
    // doubleChariotsThreateningAdvisor chapter; first example, 17:22–18:23.
    PuzzleThemeLesson(
      PuzzleTheme.doubleChariotsThreateningAdvisor,
      "t9qar8u6KIQ",
      "2r1k1b2/c2RaR3/4b4/9/1n7/9/9/9/4A4/2BA1KB2 w - - 0 1",
      List("d9e9" -> true, "e10d10" -> false, "f9f10" -> true),
      i.doubleChariotsThreateningAdvisorLesson,
      i.doubleChariotsThreateningAdvisorFinish,
      videoStartSeconds = 1011
    ),
    // moonScoopingMate chapter; first example, 23:27–26:26.
    PuzzleThemeLesson(
      PuzzleTheme.moonScoopingMate,
      "t9qar8u6KIQ",
      "3k5/9/9/9/9/2C1R4/9/3r5/9/4K4 w - - 0 1",
      List(
        "c5c10" -> false,
        "d3d6" -> false,
        "e5e10" -> true,
        "d10d9" -> false,
        "c10d10" -> false,
        "d6g6" -> false,
        "e10e7" -> false,
        "d9d10" -> false,
        "e7d7" -> true
      ),
      i.moonScoopingMateLesson,
      i.moonScoopingMateFinish,
      videoStartSeconds = 1407
    ),
    // singleHorseCapturesKing chapter; first example, 37:32–38:24.
    PuzzleThemeLesson(
      PuzzleTheme.singleHorseCapturesKing,
      "t9qar8u6KIQ",
      "9/3k5/9/9/2N6/9/9/9/9/4K4 w - - 0 1",
      List("c6b8" -> true, "d9d10" -> false, "e1e2" -> false),
      i.singleHorseCapturesKingLesson,
      i.singleHorseCapturesKingFinish,
      videoStartSeconds = 2252
    ),
    // elbowHorse chapter; first example, 40:56–42:10.
    PuzzleThemeLesson(
      PuzzleTheme.elbowHorse,
      "t9qar8u6KIQ",
      "r1bakab1r/9/9/1N5N1/9/6R2/9/9/4A4/4KA3 w - - 0 1",
      List("b7c9" -> true, "e10e9" -> false, "g5g9" -> true),
      i.elbowHorseLesson,
      i.elbowHorseFinish,
      videoStartSeconds = 2456
    ),
    // palcornerHorse chapter; first example, 48:27–50:33.
    PuzzleThemeLesson(
      PuzzleTheme.palcornerHorse,
      "t9qar8u6KIQ",
      "R2nk1rr1/1N2a2PC/9/9/9/9/8n/9/4p4/5K3 w - - 0 1",
      List("a10d10" -> true, "e9d10" -> false, "b9d8" -> true),
      i.palcornerHorseLesson,
      i.palcornerHorseFinish,
      videoStartSeconds = 2907
    ),
    // anglerHorse chapter; first example, 1:01:14–1:03:36.
    PuzzleThemeLesson(
      PuzzleTheme.anglerHorse,
      "t9qar8u6KIQ",
      "C3k4/2P1a4/2N6/9/9/2r6/9/9/4p4/5K3 w - - 0 1",
      List("c9c10" -> true, "e9d10" -> false, "c10d10" -> true),
      i.anglerHorseLesson,
      i.anglerHorseFinish,
      videoStartSeconds = 3674
    ),
    // highAnglerHorse chapter; first example, 1:15:44–1:16:51.
    PuzzleThemeLesson(
      PuzzleTheme.highAnglerHorse,
      "t9qar8u6KIQ",
      "5a3/4ak3/9/9/8N/9/R8/4p4/3p1p3/2p1K1p2 w - - 0 1",
      List("i6g7" -> true, "f9f8" -> false, "a4f4" -> true),
      i.highAnglerHorseLesson,
      i.highAnglerHorseFinish,
      videoStartSeconds = 4544
    ),
    // octagonalHorse chapter; first example, 1:26:23–1:28:16.
    PuzzleThemeLesson(
      PuzzleTheme.octagonalHorse,
      "t9qar8u6KIQ",
      "3ak4/4a1P2/9/9/2N6/6r2/9/9/3p5/4K4 w - - 0 1",
      List("c6d8" -> true, "e10f10" -> false, "g9f9" -> true),
      i.octagonalHorseLesson,
      i.octagonalHorseFinish,
      videoStartSeconds = 5183
    ),
    // springHorseMate chapter; first example, 1:36:44–1:37:53.
    PuzzleThemeLesson(
      PuzzleTheme.springHorseMate,
      "t9qar8u6KIQ",
      "1N1kr4/9/3r5/9/9/9/5n1C1/9/2R1A4/4KAB2 w - - 0 1",
      List("c2c10" -> true, "d10d9" -> false, "c10e10" -> true),
      i.springHorseMateLesson,
      i.springHorseMateFinish,
      videoStartSeconds = 5804
    ),
    // doubleHorsesMate chapter; first example, 1:42:17–1:42:59.
    PuzzleThemeLesson(
      PuzzleTheme.doubleHorsesMate,
      "t9qar8u6KIQ",
      "3k1ab2/c3a3C/4N4/2N6/9/7n1/9/3n5/4p4/c4K3 w - - 0 1",
      List("c7b9" -> true, "d10e10" -> false, "e8g9" -> true),
      i.doubleHorsesMateLesson,
      i.doubleHorsesMateFinish,
      videoStartSeconds = 6137
    ),
    // doubleCannons chapter; first example, 1:48:21–1:49:51.
    PuzzleThemeLesson(
      PuzzleTheme.doubleCannons,
      "t9qar8u6KIQ",
      "C3ka3/4a3c/9/9/6n2/9/9/1Cr6/4nK1c1/4NRB2 w - - 0 1",
      List("b3b10" -> true),
      i.doubleCannonsLesson,
      i.doubleCannonsFinish,
      videoStartSeconds = 6501
    ),
    // heavenAndEarthCannons chapter; first example, 1:58:41–2:00:07.
    PuzzleThemeLesson(
      PuzzleTheme.heavenAndEarthCannons,
      "t9qar8u6KIQ",
      "3ak4/4a4/b3b4/4C4/9/1C7/9/3R5/2r1p1p2/5K3 w - - 0 1",
      List("b5b10" -> true, "a8c10" -> false, "d3d10" -> true),
      i.heavenAndEarthCannonsLesson,
      i.heavenAndEarthCannonsFinish,
      videoStartSeconds = 7121
    ),
    // smotheredCannon chapter; first example, 2:10:01–2:10:34.
    PuzzleThemeLesson(
      PuzzleTheme.smotheredCannon,
      "t9qar8u6KIQ",
      "3ak4/2C1a4/9/9/9/9/7c1/5A3/4AK3/9 w - - 0 1",
      List("c9c10" -> true),
      i.smotheredCannonLesson,
      i.smotheredCannonFinish,
      videoStartSeconds = 7801
    ),
    // ironBolt chapter; first example, 2:18:00–2:18:54.
    PuzzleThemeLesson(
      PuzzleTheme.ironBolt,
      "t9qar8u6KIQ",
      "2bak4/4a4/4b4/4C4/9/3R5/9/9/4pr3/3K5 w - - 0 1",
      List("d5d10" -> true),
      i.ironBoltLesson,
      i.ironBoltFinish,
      videoStartSeconds = 8280
    ),
    // horseCannonMate chapter; first example, 2:25:34–2:26:27.
    PuzzleThemeLesson(
      PuzzleTheme.horseCannonMate,
      "t9qar8u6KIQ",
      "4kab2/4aR3/4bN3/4C4/9/9/9/2r1p1n2/9/4K4 w - - 0 1",
      List("f9f10" -> true, "e10f10" -> false, "e7f7" -> true),
      i.horseCannonMateLesson,
      i.horseCannonMateFinish,
      videoStartSeconds = 8734
    ),
    // cannonsSandwichingChariot chapter; first example, 2:34:19–2:34:57.
    PuzzleThemeLesson(
      PuzzleTheme.cannonsSandwichingChariot,
      "t9qar8u6KIQ",
      "2ba5/4akCRC/4c4/9/2Pn4P/p6p1/6P2/n3B1N2/3pArc2/2B1KA3 w - - 0 1",
      List("h9h8" -> true, "f9f10" -> false, "h8h10" -> true),
      i.cannonsSandwichingChariotLesson,
      i.cannonsSandwichingChariotFinish,
      videoStartSeconds = 9259
    ),
    // crowningMate chapter; first example, 2:42:29–2:43:09.
    PuzzleThemeLesson(
      PuzzleTheme.crowningMate,
      "t9qar8u6KIQ",
      "2bakab2/2R3R2/9/9/9/4C4/9/9/3r1r3/2p1K1p2 w - - 0 1",
      List("g9e9" -> true),
      i.crowningMateLesson,
      i.crowningMateFinish,
      videoStartSeconds = 9749
    ),
    // doubleToastMate chapter; first example, 2:47:16–2:48:00.
    PuzzleThemeLesson(
      PuzzleTheme.doubleToastMate,
      "t9qar8u6KIQ",
      "4kab2/4a1n2/4b4/6C2/6C2/9/9/4B4/4A4/2BAK4 w - - 0 1",
      List("g7g10" -> true, "e8g10" -> false, "g6g10" -> true),
      i.doubleToastMateLesson,
      i.doubleToastMateFinish,
      videoStartSeconds = 10036
    ),
    // doubleGhostsKnocking chapter; first example, 2:54:33–2:55:35.
    PuzzleThemeLesson(
      PuzzleTheme.doubleGhostsKnocking,
      "t9qar8u6KIQ",
      "4ka3/3PaP3/4b1N2/9/9/9/9/3n1p1n1/3Cp1r2/3p1K3 w - - 0 1",
      List("d9e9" -> true, "f10e9" -> false, "f9e9" -> true),
      i.doubleGhostsKnockingLesson,
      i.doubleGhostsKnockingFinish,
      videoStartSeconds = 10473
    ),
    // threeChariotsHarassingAdvisor chapter; first example, 3:04:23–3:05:38.
    PuzzleThemeLesson(
      PuzzleTheme.threeChariotsHarassingAdvisor,
      "t9qar8u6KIQ",
      "4ka1R1/3P1P2c/9/9/9/9/9/7n1/4p3r/5K3 w - - 0 1",
      List("f9e9" -> true),
      i.threeChariotsHarassingAdvisorLesson,
      i.threeChariotsHarassingAdvisorFinish,
      videoStartSeconds = 11063
    ),
    // centroidPawnMate chapter; first example, 3:10:05–3:10:38.
    PuzzleThemeLesson(
      PuzzleTheme.centroidPawnMate,
      "t9qar8u6KIQ",
      "3k5/4P4/9/4p3p/1N7/9/9/9/9/5K3 w - - 0 1",
      List("b6c8" -> true),
      i.centroidPawnMateLesson,
      i.centroidPawnMateFinish,
      videoStartSeconds = 11405
    ),
    // repatriationOfBuddha chapter; first example, 3:15:14–3:16:19.
    PuzzleThemeLesson(
      PuzzleTheme.repatriationOfBuddha,
      "t9qar8u6KIQ",
      "2N6/4nk3/3a5/5P1Pr/9/5c3/9/1n2B4/2pCAC3/c3KA3 w - - 0 1",
      List("f7f8" -> true, "f9f10" -> false, "f8f9" -> true, "f10e10" -> false, "f9f10" -> true),
      i.repatriationOfBuddhaLesson,
      i.repatriationOfBuddhaFinish,
      videoStartSeconds = 11714
    ),
    // whiteFacedGeneral chapter; first example, 3:21:20–3:22:41.
    PuzzleThemeLesson(
      PuzzleTheme.whiteFacedGeneral,
      "t9qar8u6KIQ",
      "r2k3cR/2n2n2C/1r7/9/9/9/4R4/3N1N3/3p1p3/4K4 w - - 0 1",
      List(
        "i10h10" -> true,
        "f9h10" -> false,
        "e4d4" -> true,
        "c9d7" -> false,
        "d4d7" -> true,
        "b8d8" -> false,
        "d7d8" -> true
      ),
      i.whiteFacedGeneralLesson,
      i.whiteFacedGeneralFinish,
      videoStartSeconds = 12080
    )
  ) ::: PuzzleOtherNamedKillLessons.all).map(lesson => lesson.theme.key -> lesson).toMap

  def find(theme: PuzzleTheme): Option[PuzzleThemeLesson] = all.get(theme.key)
