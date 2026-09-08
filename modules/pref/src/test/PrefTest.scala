package lila.pref

import munit.FunSuite
import play.api.i18n.Lang

import lila.xiangqi.Xiangqi.NotationStyle

class PrefTest extends FunSuite:

  private def lang(code: String) = Lang.get(code).get

  test("automatic Xiangqi notation follows the site language"):
    val pref = Pref.default.copy(pieceNotation = Pref.PieceNotation.AUTO)
    assertEquals(pref.xiangqiNotationStyle(lang("zh-CN")), NotationStyle.Chinese)
    assertEquals(pref.xiangqiNotationStyle(lang("zh-TW")), NotationStyle.Chinese)
    assertEquals(pref.xiangqiNotationStyle(lang("es-ES")), NotationStyle.English)

  test("explicit Xiangqi notation overrides the site language"):
    val english = Pref.default.copy(pieceNotation = Pref.PieceNotation.ENGLISH)
    val chinese = Pref.default.copy(pieceNotation = Pref.PieceNotation.CHINESE)
    assertEquals(english.xiangqiNotationStyle(lang("zh-CN")), NotationStyle.English)
    assertEquals(chinese.xiangqiNotationStyle(lang("es-ES")), NotationStyle.Chinese)

  test("board animation preferences distinguish on, off, and custom selections"):
    import Pref.BoardAnimation.*

    assert(valid(0))
    assert(valid(ALL))
    assert(valid(custom(CHECK | CHECKMATE)))
    assertEquals(mask(custom(CHECK | CHECKMATE)), CHECK | CHECKMATE)
    assert(isCustom(custom(0)))
    assert(isCustom(custom(ALL)))
    assert(!valid(CAPTURE | CHECK))
    assert(!valid(64))

  test("default appearance independently identifies every selected component"):
    val appearance = Pref.default.appearance
    assertEquals(appearance, Appearance.default)
    assertEquals(appearance.uiTheme, UiThemes.dark.key)
    assertEquals(appearance.background, Backgrounds.none.key)
    assertEquals(appearance.boardTheme, BoardThemes.lixiangqiDefault.key)
    assertEquals(appearance.pieceSet, PieceSets.wikipedia.key)
    assertEquals(appearance.soundSet, SoundSets.standard.key)
    assertEquals(appearance.musicSet, MusicSets.gentleAncient.key)
    assert(appearance.board.isDefault)

  test("appearance catalogs use unique stable keys"):
    List(
      UiThemes.all.map(_.key),
      Backgrounds.all.map(_.key),
      BoardThemes.all.map(_.key),
      PieceSets.all.map(_.key),
      SoundSets.all.map(_.key),
      MusicSets.all.map(_.key)
    ).foreach: keys =>
      assertEquals(keys.distinct, keys)

  test("background catalog follows the appearance picker order"):
    assertEquals(
      Backgrounds.all.map(_.key),
      List(
        Backgrounds.none.key,
        Backgrounds.wudang.key,
        Backgrounds.peachBlossom.key,
        Backgrounds.pangu.key,
        Backgrounds.pagoda.key,
        Backgrounds.wood.key,
        Backgrounds.greenScreen.key
      )
    )

  test("background music catalog contains only the licensed selectable tracks"):
    assertEquals(
      MusicSets.all.map(track => (track.key, track.name)),
      List(
        MusicSets.gentleAncient.key -> "Gentle Ancient-Style Music",
        MusicSets.wuxia3.key -> "Wuxia 3 (Healing)"
      )
    )
    assert(MusicSets.all.forall(_.attribution.nonEmpty))
    assert(!MusicSets.contains(MusicSets.none.key))
    assert(!MusicSets.contains("standard"))

  test("piece sets expose a complete unique CSS asset map"):
    PieceSets.all.foreach: pieceSet =>
      val assets = PieceSets.assets(pieceSet.key)
      assertEquals(assets.size, 14)
      assertEquals(assets.map(_._1).distinct, assets.map(_._1))
      assertEquals(assets.map(_._2).distinct, assets.map(_._2))
      assert(assets.forall((path, variable) => path.endsWith(".svg") && variable.startsWith("---")))

  test("piece sets are assigned to the board-piece menu categories"):
    import PieceSetCategory.*

    assertEquals(
      PieceSets.all.map(pieceSet => pieceSet.key -> pieceSet.category),
      List(
        PieceSets.wikipedia.key -> Traditional,
        PieceSets.paper.key -> Traditional,
        PieceSets.wudang.key -> Traditional,
        PieceSets.international.key -> GraphicalSymbols,
        PieceSets.western.key -> Other
      )
    )

  test("appearance component changes leave other selections unchanged"):
    val boardChange =
      PrefSingleChange.changes("boardTheme").asInstanceOf[PrefSingleChange.Change[String]]
    val changed = boardChange.update(BoardThemes.tournament.key)(Pref.default).appearance
    assertEquals(changed.uiTheme, Appearance.default.uiTheme)
    assertEquals(changed.background, Appearance.default.background)
    assertEquals(changed.boardTheme, BoardThemes.tournament.key)
    assertEquals(changed.pieceSet, Appearance.default.pieceSet)

  test("sessions persist every appearance component independently"):
    val appearance = Appearance.default.copy(
      uiTheme = UiThemes.light.key,
      background = Backgrounds.customKey,
      backgroundUrl = "https://example.test/background.jpg".some,
      boardTheme = BoardThemes.tournament.key,
      musicSet = MusicSets.wuxia3.key,
      board = Appearance.BoardSettings(brightness = 80, contrast = 120, saturation = 60, opacity = 70, hue = 15)
    )
    assertEquals(appearance.sessionValues.keySet, Appearance.sessionKeys)
    assertEquals(appearance.sessionValues("uiTheme"), UiThemes.light.key)
    assertEquals(appearance.sessionValues("backgroundUrl"), "https://example.test/background.jpg")
    assertEquals(appearance.sessionValues("boardBrightness"), "80")
    assertEquals(appearance.sessionValues("boardSaturation"), "60")

  test("background selection resolves registered and custom images"):
    assertEquals(Appearance.default.backgroundImage, None)
    assertEquals(Backgrounds.greenScreen.image, "/assets/images/background/green-screen.svg".some)
    assertEquals(
      Appearance.default.copy(background = Backgrounds.pangu.key).backgroundImage,
      Backgrounds.pangu.image
    )
    val customUrl = "https://example.test/background.jpg"
    assertEquals(
      Appearance.default
        .copy(background = Backgrounds.customKey, backgroundUrl = customUrl.some)
        .backgroundImage,
      customUrl.some
    )
