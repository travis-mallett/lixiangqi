package lila.pref

import munit.FunSuite
import reactivemongo.api.bson.*

import PrefHandlers.given

class AppearanceReadTest extends FunSuite:

  private val reader = summon[BSONDocumentHandler[Appearance]]

  private val invalidPieceSets: List[BSONValue] = List(
    BSONString("xiangqi-wikipedia"),
    BSONString("xiangqi-paper"),
    BSONString("unknown-future-piece-set"),
    BSONString(""),
    BSONInteger(42),
    BSONNull,
    BSONDocument("key" -> "invalid")
  )

  test("missing appearance selections use the current defaults"):
    assertEquals(reader.readDocument(BSONDocument.empty).get, Appearance.default)

  test("retired and malformed saved piece sets resolve without changing other preferences"):
    invalidPieceSets.foreach: value =>
      val document = BSONDocument(
        "pieceSet" -> value,
        "uiTheme" -> UiThemes.light.key,
        "boardTheme" -> BoardThemes.tournament.key,
        "musicSet" -> MusicSets.wuxia3.key
      )
      val appearance = reader.readDocument(document).get
      assertEquals(
        appearance,
        Appearance.default.copy(
          uiTheme = UiThemes.light.key,
          boardTheme = BoardThemes.tournament.key,
          musicSet = MusicSets.wuxia3.key
        )
      )
      val saved = reader.writeTry(appearance).get
      assertEquals(saved.getAsOpt[String]("pieceSet"), Some(PieceSets.default.key))

  test("a legacy pack cannot override the default for an explicitly invalid piece set"):
    invalidPieceSets.foreach: value =>
      val appearance = reader.readDocument(BSONDocument("pack" -> "wudang", "pieceSet" -> value)).get
      assertEquals(appearance.pieceSet, PieceSets.default.key)
      assertEquals(appearance.uiTheme, UiThemes.wudang.key)
    val legacy = reader.readDocument(BSONDocument("pack" -> "wudang")).get
    assertEquals(legacy.pieceSet, PieceSets.wudang.key)

  test("every selectable piece set survives preference loading"):
    PieceSets.all.foreach: pieceSet =>
      val appearance = reader.readDocument(BSONDocument("pieceSet" -> pieceSet.key)).get
      assertEquals(appearance.pieceSet, pieceSet.key)

  test("invalid appearance keys fall back to their current component defaults"):
    val document = BSONDocument(
      "uiTheme" -> "removed",
      "background" -> "removed",
      "boardTheme" -> "removed",
      "pieceSet" -> "removed",
      "soundSet" -> "removed",
      "musicSet" -> "removed"
    )
    assertEquals(reader.readDocument(document).get, Appearance.default)

  test("complete user profiles tolerate retired piece sets"):
    val handler = summon[BSONDocumentHandler[Pref]]
    invalidPieceSets.foreach: value =>
      val document = BSONDocument(
        "_id" -> "appearance-test",
        "appearance" -> BSONDocument("pieceSet" -> value),
        "ratings" -> 0
      )
      val pref = handler.readDocument(document).get
      assertEquals(pref.appearance.pieceSet, PieceSets.default.key)
      assertEquals(pref.ratings, 0)

  test("piece lookups and asset paths share the current default for missing or invalid keys"):
    assertEquals(PieceSets.get(None), PieceSets.default)
    List("xiangqi-wikipedia", "xiangqi-paper", "unknown", "", "../missing").foreach: key =>
      assert(!PieceSets.contains(key))
      assertEquals(PieceSets.get(Some(key)), PieceSets.default)
      assertEquals(PieceSets.assets(key), PieceSets.assets(PieceSets.default.key))

  test("matching pieces default on for existing records and preserve an explicit opt-out"):
    assert(reader.readDocument(BSONDocument.empty).get.selectMatchingPieces)
    val optedOut = Appearance.default.copy(selectMatchingPieces = false)
    assertEquals(reader.readDocument(reader.writeTry(optedOut).get).get, optedOut)
    assertEquals(optedOut.sessionValues("selectMatchingPieces"), "false")

  test("retired boards resolve to the default without replacing saved pieces"):
    val appearance = reader
      .readDocument(
        BSONDocument(
          "boardTheme" -> "xiangqi-wikipedia",
          "pieceSet" -> PieceSets.western.key
        )
      )
      .get
    assertEquals(appearance.boardTheme, BoardThemes.lixiangqiDefault.key)
    assertEquals(appearance.pieceSet, PieceSets.western.key)
    assert(!BoardThemes.contains("xiangqi-wikipedia"))

  test("board selection matches pieces only when enabled"):
    val original = Appearance.default.copy(pieceSet = PieceSets.western.key)
    List(
      BoardThemes.lixiangqiDefault -> PieceSets.defaultWood,
      BoardThemes.paperBoard -> PieceSets.international,
      BoardThemes.wudang -> PieceSets.wudang,
      BoardThemes.tournament -> PieceSets.defaultWood
    ).foreach: (board, pieces) =>
      assertEquals(original.selectBoard(board.key).pieceSet, pieces.key)
      assertEquals(
        original.copy(selectMatchingPieces = false).selectBoard(board.key).pieceSet,
        original.pieceSet
      )
