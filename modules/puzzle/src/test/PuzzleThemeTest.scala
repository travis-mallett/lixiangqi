package lila.puzzle

class PuzzleThemeTest extends munit.FunSuite:
  test("named and piece-type themes are selectable, dynamic tags; headings are not tags"):
    val sections = PuzzleTheme.categorized.take(2)
    assertEquals(
      sections.map(_.categories.map(_.themes.size)),
      List(List(4, 8, 8, 4, 1, 28, 15), List(4, 3))
    )
    val themes = sections.flatMap(_.categories.flatMap(_.themes))
    assertEquals(themes.map(_.key).distinct.size, 75)
    themes.foreach: theme =>
      assertEquals(PuzzleTheme.findDynamic(theme.key.value), Some(theme))
      assertEquals(PuzzleAngle.find(theme.key.value).flatMap(_.asTheme), Some(theme.key))
    val headings = sections.map(_.name) ::: sections.flatMap(_.categories.map(_.name))
    headings.foreach: heading =>
      assertEquals(PuzzleTheme.findAny(heading.value.split(":").last), None)

  test("all basic kills are recognized as mating themes, tactics are not"):
    PuzzleTheme.pieceTypeMates.foreach: theme =>
      assert(PuzzleTheme.allMates(theme.key))
      assert(PuzzleTheme.visible.contains(theme))
      assertEquals(theme.iconFile, s"${theme.key.value}.webp")
    assert(PuzzleTheme.allMates(PuzzleTheme.doubleCannons.key))
    assert(PuzzleTheme.allMates(PuzzleTheme.octagonalHorse.key))
    assert(PuzzleTheme.allMates(PuzzleTheme.doubleHorsesMate.key))
    assert(PuzzleTheme.visible.contains(PuzzleTheme.doubleHorsesMate))
    assert(PuzzleTheme.allMates(PuzzleTheme.springHorseMate.key))
    assert(PuzzleTheme.visible.contains(PuzzleTheme.springHorseMate))
    assertEquals(PuzzleTheme.springHorseMate.iconFile, "springHorseMate.webp")
    assert(!PuzzleTheme.allMates(PuzzleTheme.winningMaterialByTrapping.key))

  test("other named basic kills precede piece-type methods and use their illustrated icons"):
    val categories = PuzzleTheme.categorized.head.categories
    assertEquals(categories.last.themes, PuzzleTheme.pieceTypeMates)
    val category = categories.init.last
    assertEquals(category.themes, PuzzleTheme.otherNamedBasicKills)
    assertEquals(category.themes.head, PuzzleTheme.threeChariotAttack)
    val smallThroatIndex = category.themes.indexOf(PuzzleTheme.smallThroatCuttingMate)
    assertEquals(category.themes(smallThroatIndex - 1), PuzzleTheme.boldChariotAttack)
    assertEquals(category.themes(smallThroatIndex + 1), PuzzleTheme.pawnTripleAdvancementAttack)
    val smallIronIndex = category.themes.indexOf(PuzzleTheme.smallIronBolt)
    assertEquals(category.themes(smallIronIndex + 1), PuzzleTheme.cannonChariotDiscoveredAttack)
    category.themes.foreach: theme =>
      assert(PuzzleTheme.allMates(theme.key))
      assertEquals(theme.iconFile, s"${theme.key.value}.webp")
