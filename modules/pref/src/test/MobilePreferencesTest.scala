package lila.pref

class MobilePreferencesTest extends munit.FunSuite:
  test("all native preference controls use validated single-field changes"):
    val required = Set(
      "animation",
      "boardAnimations",
      "captured",
      "highlight",
      "destination",
      "coords",
      "replay",
      "pieceNotation",
      "zen",
      "resizeHandle",
      "ratings",
      "flairs",
      "moveEvent",
      "premove",
      "takeback",
      "autoQueen",
      "autoThreefold",
      "submitMove",
      "confirmResign",
      "keyboardMove",
      "voice",
      "rookCastle",
      "sayGG",
      "clockTenths",
      "clockBar",
      "clockSound",
      "moretime",
      "follow",
      "challenge",
      "message",
      "studyInvite",
      "insightShare",
      "usingAltSocket",
      "uiTheme",
      "background",
      "backgroundUrl",
      "boardTheme",
      "pieceSet",
      "soundSet",
      "musicSet",
      "selectMatchingPieces",
      "boardBrightness",
      "boardContrast",
      "boardSaturation",
      "boardOpacity",
      "boardHue"
    )
    assert(required.subsetOf(PrefSingleChange.changes.keySet))

  test("native changes preserve unrelated values and validate bounds"):
    val before = Pref.default.copy(takeback = 1, message = 2)
    val change = PrefSingleChange.changes("coords")
    val value = change.form.bind(Map("coords" -> "2")).get
    assertEquals(change.update(value)(before), before.copy(coords = 2))
    assert(change.form.bind(Map("coords" -> "99")).hasErrors)
    assert(PrefSingleChange.changes("boardBrightness").form.bind(Map("boardBrightness" -> "19")).hasErrors)

  test("move confirmation rejects undefined and negative bit masks"):
    val form = PrefSingleChange.changes("submitMove").form
    (0 to 31).foreach(v => assert(!form.bind(Map("submitMove" -> v.toString)).hasErrors))
    List(-1, 32, 33, 255).foreach(v => assert(form.bind(Map("submitMove" -> v.toString)).hasErrors))

  test("settings JSON includes the previously omitted website preferences"):
    val json = toJson(Pref.default, lichobileCompat = false)
    assertEquals((json \ "studyInvite").as[Int], Pref.default.studyInvite)
    assertEquals((json \ "resizeHandle").as[Int], Pref.default.resizeHandle)
    assertEquals((json \ "usingAltSocket").as[Boolean], false)
