package lila.pref

import reactivemongo.api.bson.*

import lila.core.ublog.QualityFilter as BlogQualityFilter
import lila.db.BSON
import lila.db.dsl.{ *, given }

private object PrefHandlers:

  given BSONDocumentHandler[Appearance.BoardSettings] = new BSON[Appearance.BoardSettings]:

    def reads(r: BSON.Reader): Appearance.BoardSettings =
      val d = Appearance.defaultBoardSettings
      Appearance.BoardSettings(
        brightness = r.getD("brightness", d.brightness),
        contrast = r.getD("contrast", d.contrast),
        opacity = r.getD("opacity", d.opacity),
        hue = r.getD("hue", d.hue)
      )

    def writes(w: BSON.Writer, o: Appearance.BoardSettings) =
      $doc(
        "brightness" -> o.brightness,
        "contrast" -> o.contrast,
        "opacity" -> o.opacity,
        "hue" -> o.hue
      )

  given BSONDocumentHandler[Appearance] = new BSON[Appearance]:

    private def key(
        r: BSON.Reader,
        name: String,
        default: String,
        valid: String => Boolean
    ): String =
      r.strO(name).filter(valid) | default

    def reads(r: BSON.Reader): Appearance =
      val d = ThemePacks.default.appearance
      val pack = key(r, "pack", d.pack, ThemePacks.isValidSelection)
      ThemePacks.get(pack) match
        case Some(themePack) => themePack.appearance
        case None =>
          val background = key(r, "background", d.background, Backgrounds.contains)
          Appearance(
            pack = ThemePacks.customKey,
            uiTheme = key(r, "uiTheme", d.uiTheme, UiThemes.contains),
            background = background,
            backgroundUrl = Option
              .when(background == Backgrounds.customKey)(r.strO("backgroundUrl"))
              .flatten
              .filterNot(_.isBlank),
            boardTheme = key(r, "boardTheme", d.boardTheme, BoardThemes.contains),
            pieceSet = key(r, "pieceSet", d.pieceSet, PieceSets.contains),
            soundSet = key(r, "soundSet", d.soundSet, SoundSets.contains),
            musicSet = key(r, "musicSet", d.musicSet, MusicSets.contains),
            board = r.getD("board", d.board)
          )

    def writes(w: BSON.Writer, o: Appearance) =
      if o.pack != ThemePacks.customKey then $doc("pack" -> o.pack)
      else
        $doc(
          "pack" -> o.pack,
          "uiTheme" -> o.uiTheme,
          "background" -> o.background,
          "backgroundUrl" -> o.backgroundUrl,
          "boardTheme" -> o.boardTheme,
          "pieceSet" -> o.pieceSet,
          "soundSet" -> o.soundSet,
          "musicSet" -> o.musicSet,
          "board" -> o.board
        )

  given BSONDocumentHandler[Pref] = new BSON[Pref]:

    def reads(r: BSON.Reader): Pref =
      val d = Pref.default
      Pref(
        id = r.get[UserId]("_id"),
        appearance = r.getD("appearance", d.appearance),
        autoQueen = r.getD("autoQueen", d.autoQueen),
        autoThreefold = r.getD("autoThreefold", d.autoThreefold),
        takeback = r.getD("takeback", d.takeback),
        moretime = r.getD("moretime", d.moretime),
        clockTenths = r.getD("clockTenths", d.clockTenths),
        clockBar = r.getD("clockBar", d.clockBar),
        clockSound = r.getD("clockSound", d.clockSound),
        premove = r.getD("premove", d.premove),
        animation = r.getD("animation", d.animation),
        captured = r.getD("captured", d.captured),
        follow = r.getD("follow", d.follow),
        highlight = r.getD("highlight", d.highlight),
        destination = r.getD("destination", d.destination),
        coords = r.getD("coords", d.coords),
        replay = r.getD("replay", d.replay),
        challenge = r.getD("challenge", d.challenge),
        message = r.getD("message", d.message),
        studyInvite = r.getD("studyInvite", d.studyInvite),
        submitMove = r.getD("submitMove", d.submitMove),
        confirmResign = r.getD("confirmResign", d.confirmResign),
        insightShare = r.getD("insightShare", d.insightShare),
        keyboardMove = r.getD("keyboardMove", d.keyboardMove),
        voice = r.getO("voice"),
        zen = r.getD("zen", d.zen),
        ratings = r.getD("ratings", d.ratings),
        flairs = r.getD("flairs", d.flairs),
        rookCastle = r.getD("rookCastle", d.rookCastle),
        pieceNotation = r.getD("pieceNotation", d.pieceNotation),
        resizeHandle = r.getD("resizeHandle", d.resizeHandle),
        moveEvent = r.getD("moveEvent", d.moveEvent),
        agreement = r.getD("agreement", 0),
        blogFilter = r.strO("blogFilter").flatMap(BlogQualityFilter.fromName) | d.blogFilter,
        usingAltSocket = r.getO("usingAltSocket"),
        sayGG = r.getD("sayGG", d.sayGG),
        tags = r.getD("tags", d.tags)
      )

    def writes(w: BSON.Writer, o: Pref) =
      $doc(
        "_id" -> o.id,
        "appearance" -> o.appearance,
        "autoQueen" -> o.autoQueen,
        "autoThreefold" -> o.autoThreefold,
        "takeback" -> o.takeback,
        "moretime" -> o.moretime,
        "clockTenths" -> o.clockTenths,
        "clockBar" -> o.clockBar,
        "clockSound" -> o.clockSound,
        "premove" -> o.premove,
        "animation" -> o.animation,
        "captured" -> o.captured,
        "follow" -> o.follow,
        "highlight" -> o.highlight,
        "destination" -> o.destination,
        "coords" -> o.coords,
        "replay" -> o.replay,
        "challenge" -> o.challenge,
        "message" -> o.message,
        "studyInvite" -> o.studyInvite,
        "submitMove" -> o.submitMove,
        "confirmResign" -> o.confirmResign,
        "insightShare" -> o.insightShare,
        "keyboardMove" -> o.keyboardMove,
        "voice" -> o.voice,
        "zen" -> o.zen,
        "ratings" -> o.ratings,
        "flairs" -> o.flairs,
        "rookCastle" -> o.rookCastle,
        "moveEvent" -> o.moveEvent,
        "pieceNotation" -> o.pieceNotation,
        "resizeHandle" -> o.resizeHandle,
        "agreement" -> o.agreement,
        "usingAltSocket" -> o.usingAltSocket,
        "blogFilter" -> o.blogFilter.ordinal,
        "sayGG" -> o.sayGG,
        "tags" -> o.tags
      )
