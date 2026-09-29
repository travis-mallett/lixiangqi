package lila.pref

import play.api.libs.json.*

case class Appearance(
    uiTheme: String,
    background: String,
    backgroundUrl: Option[String],
    boardTheme: String,
    pieceSet: String,
    soundSet: String,
    musicSet: String,
    board: Appearance.BoardSettings,
    selectMatchingPieces: Boolean = true
):

  def selectBoard(key: String): Appearance =
    copy(
      boardTheme = key,
      pieceSet =
        if selectMatchingPieces then BoardThemes(key).matchingPieceSet.getOrElse(pieceSet) else pieceSet
    )

  def sessionValues: Map[String, String] =
    Map(
      "uiTheme" -> uiTheme,
      "background" -> background,
      "boardTheme" -> boardTheme,
      "pieceSet" -> pieceSet,
      "selectMatchingPieces" -> selectMatchingPieces.toString,
      "soundSet" -> soundSet,
      "musicSet" -> musicSet,
      "boardBrightness" -> board.brightness.toString,
      "boardContrast" -> board.contrast.toString,
      "boardSaturation" -> board.saturation.toString,
      "boardOpacity" -> board.opacity.toString,
      "boardHue" -> board.hue.toString
    ) ++ backgroundUrl.map("backgroundUrl" -> _)

  def backgroundImage: Option[String] =
    if background == Backgrounds.customKey then backgroundUrl
    else Backgrounds.get(background).flatMap(_.image)

  def colorScheme: ColorScheme = UiThemes(uiTheme).colorScheme

object Appearance:

  val sessionKeys: Set[String] = Set(
    "uiTheme",
    "background",
    "backgroundUrl",
    "boardTheme",
    "pieceSet",
    "selectMatchingPieces",
    "soundSet",
    "musicSet",
    "boardBrightness",
    "boardContrast",
    "boardSaturation",
    "boardOpacity",
    "boardHue"
  )

  case class BoardSettings(
      brightness: Int,
      contrast: Int,
      saturation: Int,
      opacity: Int,
      hue: Int
  ):
    def isDefault: Boolean =
      brightness == 100 && contrast == 100 && saturation == 100 && opacity == 100 && hue == 0

  val defaultBoardSettings = BoardSettings(
    brightness = 100,
    contrast = 100,
    saturation = 100,
    opacity = 100,
    hue = 0
  )

  given OWrites[BoardSettings] = Json.writes[BoardSettings]
  given OWrites[Appearance] = Json.writes[Appearance]

  val default = Appearance(
    uiTheme = UiThemes.dark.key,
    background = Backgrounds.none.key,
    backgroundUrl = None,
    boardTheme = BoardThemes.lixiangqiDefault.key,
    pieceSet = PieceSets.default.key,
    soundSet = SoundSets.standard.key,
    musicSet = MusicSets.gentleAncient.key,
    board = defaultBoardSettings
  )

enum ColorScheme(val key: String):
  case Light extends ColorScheme("light")
  case Dark extends ColorScheme("dark")

case class UiTheme(
    key: String,
    name: String,
    colorScheme: ColorScheme,
    previewBackground: String,
    previewPanel: String,
    previewPanelLow: String,
    previewAccent: String
)

object UiThemes:
  val dark = UiTheme("dark", "Dark", ColorScheme.Dark, "#312e2b", "#4b4742", "#5c5751", "#629924")
  val light = UiTheme("light", "Light", ColorScheme.Light, "#e7e3dd", "#ffffff", "#dddddd", "#629924")
  val wood = UiTheme("wood", "Wood", ColorScheme.Light, "#bc8045", "#fbf7ee", "#f2eadb", "#a92f28")
  val wudang = UiTheme(
    "wudang",
    "Seeking the Dao at Wudang",
    ColorScheme.Dark,
    "#d8d5cc",
    "#152022",
    "#e9e4d8",
    "#963f36"
  )
  val system = UiTheme("system", "Device theme", ColorScheme.Dark, "#312e2b", "#4b4742", "#5c5751", "#629924")

  val all = List(dark, light, wood, wudang, system)
  private val byKey = all.mapBy(_.key)

  def apply(key: String): UiTheme = byKey(key)
  def contains(key: String): Boolean = byKey.contains(key)

  given Writes[UiTheme] = Writes: theme =>
    Json.obj(
      "key" -> theme.key,
      "name" -> theme.name,
      "colorScheme" -> theme.colorScheme.key,
      "previewBackground" -> theme.previewBackground,
      "previewPanel" -> theme.previewPanel,
      "previewPanelLow" -> theme.previewPanelLow,
      "previewAccent" -> theme.previewAccent
    )

case class Background(key: String, name: String, image: Option[String])

object Backgrounds:
  val none = Background("none", "None", None)
  val greenScreen = Background(
    "green-screen",
    "Green Screen",
    "/assets/images/background/green-screen.svg".some
  )
  val pangu = Background(
    "pangu-opened-the-sky",
    "Pangu Opened the Sky",
    "/assets/images/background/pangu-opened-the-sky.webp".some
  )
  val peachBlossom = Background(
    "peach-blossom-spring",
    "Peach Blossom Spring",
    "/assets/images/background/peach-blossom-spring.webp".some
  )
  val wudang = Background(
    "seeking-the-dao-at-wudang",
    "Seeking the Dao at Wudang",
    "/assets/images/background/seeking-the-dao-at-wudang.webp".some
  )
  val pagoda = Background(
    "glazed-treasure-pagoda",
    "Glazed Treasure Pagoda",
    "/assets/images/background/glazed-treasure-pagoda.webp".some
  )
  val wood = Background(
    "wood-background",
    "Wood",
    "/assets/images/background/wood-background.webp".some
  )

  val customKey = "custom"
  val all = List(none, wudang, peachBlossom, pangu, pagoda, wood, greenScreen)
  private val byKey = all.mapBy(_.key)

  def get(key: String): Option[Background] = byKey.get(key)
  def contains(key: String): Boolean = key == customKey || byKey.contains(key)

  given Writes[Background] = Json.writes[Background]

case class BoardTheme(
    key: String,
    name: String,
    file: String,
    coordinateLight: String,
    coordinateDark: String,
    matchingPieceSet: Option[String] = None
)

object BoardThemes:
  val all = BoardCatalog.boards
  private val byKey = all.mapBy(_.key)
  val lixiangqiDefault = byKey((BoardCatalog.json \ "defaultBoard").as[String])
  val paperBoard = byKey("paper-board")
  val tournament = byKey("xiangqi-tournament")
  val wudang = byKey("xiangqi-wudang")

  def apply(key: String): BoardTheme = byKey(key)
  def get(key: Option[String]): BoardTheme = key.flatMap(byKey.get) | lixiangqiDefault
  def contains(key: String): Boolean = byKey.contains(key)

  given Writes[BoardTheme] = Json.writes[BoardTheme]

enum PieceSetCategory(val key: String):
  case Traditional extends PieceSetCategory("traditional")
  case GraphicalSymbols extends PieceSetCategory("graphicalSymbols")
  case Other extends PieceSetCategory("other")

case class PieceSet(key: String, name: String, category: PieceSetCategory)

object PieceSets:
  val shadows: List[(String, String)] = BoardCatalog.shadows
  val all = BoardCatalog.pieces
  private val byKey = all.mapBy(_.key)
  val defaultWood = byKey("default-wood")
  val wudang = byKey("xiangqi-wudang")
  val paperTraditional = byKey("xiangqi-paper-traditional")
  val international = byKey("xiangqi-international")
  val western = byKey("xiangqi-western")
  val default = byKey((BoardCatalog.json \ "defaultPieces").as[String])

  def assets(key: String): List[(String, String)] = BoardCatalog.pieceAssets(get(Some(key)).key, "xiangqi")

  def get(key: Option[String]): PieceSet = key.flatMap(byKey.get) | default
  def contains(key: String): Boolean = byKey.contains(key)

  given Writes[PieceSet] = Writes: pieceSet =>
    Json.obj(
      "key" -> pieceSet.key,
      "name" -> pieceSet.name,
      "category" -> pieceSet.category.key,
      "assets" -> JsObject(
        assets(pieceSet.key).map: (path, variable) =>
          variable -> JsString(path)
      )
    )

case class SoundSet(key: String, name: String)

object SoundSets:
  val none = SoundSet("none", "None")
  val standard = SoundSet("standard", "Standard")

  val all = List(none, standard)
  private val byKey = all.mapBy(_.key)

  def contains(key: String): Boolean = byKey.contains(key)

  given Writes[SoundSet] = Json.writes[SoundSet]

case class MusicSet(key: String, name: String, attribution: String)

object MusicSets:
  // Used by embedded pages, where background music must never start.
  val none = MusicSet("none", "None", "")
  val gentleAncient = MusicSet(
    "gentle-ancient",
    "Gentle Ancient-Style Music",
    "“Gentle Ancient-Style Music” (《温婉的古风音乐》) by 碎碎平安的碎碎 — " +
      "https://www.ear0.com/sound/show/soundid-43881 — CC BY 3.0 China"
  )
  val wuxia3 = MusicSet(
    "wuxia3",
    "Wuxia 3 (Healing)",
    "“Wuxia3” by PeriTune — https://peritune.com/ — CC BY 4.0"
  )

  val all = List(gentleAncient, wuxia3)
  private val byKey = all.mapBy(_.key)

  def contains(key: String): Boolean = byKey.contains(key)

  given Writes[MusicSet] = Json.writes[MusicSet]
