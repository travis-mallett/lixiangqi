package lila.pref

import play.api.mvc.RequestHeader

object RequestPref:

  import Pref.default

  def queryParamOverride(req: RequestHeader)(pref: Pref): Pref =
    queryParam(req.queryString, "appearancePack")
      .flatMap(ThemePacks.get)
      .fold(pref)(pack => pref.copy(appearance = pack.appearance))

  def fromRequest(req: RequestHeader): Pref =
    val qs = req.queryString
    if qs.isEmpty && req.session.isEmpty then default
    else
      def paramOrSession(name: String): Option[String] =
        queryParam(qs, name).orElse(req.session.get(name))

      val packed =
        paramOrSession("appearancePack").flatMap(ThemePacks.get).fold(default.appearance)(_.appearance)
      val uiTheme = paramOrSession("uiTheme").filter(UiThemes.contains) | packed.uiTheme
      val background = paramOrSession("background").filter(Backgrounds.contains) | packed.background
      val boardTheme = paramOrSession("boardTheme").filter(BoardThemes.contains) | packed.boardTheme
      val pieceSet = paramOrSession("pieceSet").filter(PieceSets.contains) | packed.pieceSet
      val soundSet = paramOrSession("soundSet").filter(SoundSets.contains) | packed.soundSet
      val musicSet = paramOrSession("musicSet").filter(MusicSets.contains) | packed.musicSet
      val backgroundUrl =
        Option.when(background == Backgrounds.customKey)(paramOrSession("backgroundUrl")).flatten
      val board = packed.board.copy(
        opacity = intParam(paramOrSession("boardOpacity"), packed.board.opacity, 0, 100),
        brightness = intParam(paramOrSession("boardBrightness"), packed.board.brightness, 20, 140),
        contrast = intParam(paramOrSession("boardContrast"), packed.board.contrast, 40, 200),
        hue = intParam(paramOrSession("boardHue"), packed.board.hue, 0, 100)
      )
      val appearance = packed.copy(
        pack =
          if List(uiTheme, background, boardTheme, pieceSet, soundSet, musicSet) ==
              List(
                packed.uiTheme,
                packed.background,
                packed.boardTheme,
                packed.pieceSet,
                packed.soundSet,
                packed.musicSet
              ) && backgroundUrl == packed.backgroundUrl && board == packed.board
          then packed.pack
          else ThemePacks.customKey,
        uiTheme = uiTheme,
        background = background,
        backgroundUrl = backgroundUrl,
        boardTheme = boardTheme,
        pieceSet = pieceSet,
        soundSet = soundSet,
        musicSet = musicSet,
        board = board
      )
      default.copy(appearance = appearance)

  private def intParam(value: Option[String], default: Int, min: Int, max: Int): Int =
    value.flatMap(_.toIntOption).fold(default)(_.max(min).min(max))

  private def queryParam(queryString: Map[String, Seq[String]], name: String): Option[String] =
    queryString
      .get(name)
      .flatMap(_.headOption)
      .filter: value =>
        value.nonEmpty && value != "auto"
