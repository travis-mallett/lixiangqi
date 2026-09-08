package lila.pref

import play.api.mvc.RequestHeader

object RequestPref:

  import Pref.default

  def queryParamOverride(req: RequestHeader)(pref: Pref): Pref =
    pref.copy(appearance = appearanceFrom(name => queryParam(req.queryString, name), pref.appearance))

  def fromRequest(req: RequestHeader): Pref =
    val qs = req.queryString
    if qs.isEmpty && req.session.isEmpty then default
    else
      def paramOrSession(name: String): Option[String] =
        queryParam(qs, name).orElse(req.session.get(name))

      default.copy(appearance = appearanceFrom(paramOrSession, default.appearance))

  private def appearanceFrom(read: String => Option[String], base: Appearance): Appearance =
    val background = read("background").filter(Backgrounds.contains) | base.background
    base.copy(
      uiTheme = read("uiTheme").filter(UiThemes.contains) | base.uiTheme,
      background = background,
      backgroundUrl = Option
        .when(background == Backgrounds.customKey)(read("backgroundUrl").orElse(base.backgroundUrl))
        .flatten,
      boardTheme = read("boardTheme").filter(BoardThemes.contains) | base.boardTheme,
      pieceSet = read("pieceSet").filter(PieceSets.contains) | base.pieceSet,
      soundSet = read("soundSet").filter(SoundSets.contains) | base.soundSet,
      musicSet = read("musicSet").filter(MusicSets.contains) | base.musicSet,
      board = base.board.copy(
        opacity = intParam(read("boardOpacity"), base.board.opacity, 0, 100),
        brightness = intParam(read("boardBrightness"), base.board.brightness, 20, 140),
        contrast = intParam(read("boardContrast"), base.board.contrast, 40, 200),
        saturation = intParam(read("boardSaturation"), base.board.saturation, 0, 200),
        hue = intParam(read("boardHue"), base.board.hue, 0, 100)
      )
    )

  private def intParam(value: Option[String], default: Int, min: Int, max: Int): Int =
    value.flatMap(_.toIntOption).fold(default)(_.max(min).min(max))

  private def queryParam(queryString: Map[String, Seq[String]], name: String): Option[String] =
    queryString
      .get(name)
      .flatMap(_.headOption)
      .filter: value =>
        value.nonEmpty && value != "auto"
