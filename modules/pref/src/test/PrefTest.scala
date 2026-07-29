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

  test("dark is the default complete theme pack"):
    val appearance = Pref.default.appearance
    assertEquals(appearance, ThemePacks.dark.appearance)
    assertEquals(appearance.pack, "dark")
    assertEquals(appearance.uiTheme, UiThemes.dark.key)
    assertEquals(appearance.background, Backgrounds.none.key)
    assertEquals(appearance.boardTheme, BoardThemes.wikipedia.key)
    assertEquals(appearance.pieceSet, PieceSets.wikipedia.key)
    assertEquals(appearance.soundSet, SoundSets.standard.key)
    assertEquals(appearance.musicSet, MusicSets.gentleAncient.key)
    assert(appearance.board.isDefault)

  test("every theme pack only references registered appearance assets"):
    ThemePacks.all.foreach: pack =>
      val appearance = pack.appearance
      assertEquals(appearance.pack, pack.key)
      assert(UiThemes.contains(appearance.uiTheme))
      assert(Backgrounds.contains(appearance.background))
      assert(BoardThemes.contains(appearance.boardTheme))
      assert(PieceSets.contains(appearance.pieceSet))
      assert(SoundSets.contains(appearance.soundSet))
      assert(MusicSets.contains(appearance.musicSet))

  test("appearance catalogs use unique stable keys"):
    List(
      ThemePacks.all.map(_.key),
      UiThemes.all.map(_.key),
      Backgrounds.all.map(_.key),
      BoardThemes.all.map(_.key),
      PieceSets.all.map(_.key),
      SoundSets.all.map(_.key),
      MusicSets.all.map(_.key)
    ).foreach: keys =>
      assertEquals(keys.distinct, keys)

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

  test("manual appearance changes become a custom combination"):
    val customized = ThemePacks.normalize(
      ThemePacks.light.appearance.copy(boardTheme = BoardThemes.tournament.key)
    )
    assertEquals(customized.pack, ThemePacks.customKey)
    assertEquals(customized.uiTheme, UiThemes.light.key)
    assertEquals(customized.boardTheme, BoardThemes.tournament.key)

  test("a custom combination matching a pack resolves back to that pack"):
    val customized = ThemePacks.dark.appearance.customized
    assertEquals(ThemePacks.normalize(customized), ThemePacks.dark.appearance)

  test("restoring a pack default through a component preference restores the pack identity"):
    val musicChange =
      PrefSingleChange.changes("musicSet").asInstanceOf[PrefSingleChange.Change[String]]
    val custom = Pref.default.copy(
      appearance = ThemePacks.dark.appearance.customized.copy(musicSet = MusicSets.wuxia3.key)
    )
    assertEquals(
      musicChange.update(MusicSets.gentleAncient.key)(custom).appearance,
      ThemePacks.dark.appearance
    )

  test("named theme packs replace custom appearance session values atomically"):
    assertEquals(
      ThemePacks.light.appearance.sessionValues,
      Map("appearancePack" -> ThemePacks.light.key)
    )

  test("custom combinations persist every appearance component without a pack overlay"):
    val custom = ThemePacks.light.appearance.customized.copy(
      background = Backgrounds.customKey,
      backgroundUrl = "https://example.test/background.jpg".some,
      boardTheme = BoardThemes.tournament.key,
      musicSet = MusicSets.gentleAncient.key,
      board = Appearance.BoardSettings(brightness = 80, contrast = 120, opacity = 70, hue = 15)
    )
    assertEquals(custom.sessionValues.keySet, Appearance.sessionKeys - "appearancePack")
    assertEquals(custom.sessionValues("uiTheme"), UiThemes.light.key)
    assertEquals(custom.sessionValues("backgroundUrl"), "https://example.test/background.jpg")
    assertEquals(custom.sessionValues("boardBrightness"), "80")

  test("background selection resolves registered and custom images"):
    assertEquals(ThemePacks.dark.appearance.backgroundImage, None)
    assertEquals(Backgrounds.greenScreen.image, "/assets/images/background/green-screen.svg".some)
    assertEquals(
      ThemePacks.dark.appearance.customized
        .copy(background = Backgrounds.pangu.key)
        .backgroundImage,
      Backgrounds.pangu.image
    )
    val customUrl = "https://example.test/background.jpg"
    assertEquals(
      ThemePacks.dark.appearance.customized
        .copy(background = Backgrounds.customKey, backgroundUrl = customUrl.some)
        .backgroundImage,
      customUrl.some
    )
