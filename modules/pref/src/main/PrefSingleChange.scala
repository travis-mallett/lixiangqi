package lila.pref

object PrefSingleChange:

  type Change[A] = lila.common.Form.SingleChange.Change[Pref, A]
  private def changing[A] = lila.common.Form.SingleChange.changing[Pref, PrefForm.fields.type, A]
  private def changeAppearance(update: Appearance => Appearance)(pref: Pref): Pref =
    pref.copy(appearance = ThemePacks.normalize(update(pref.appearance)))

  val changes: Map[String, Change[?]] = List[Change[?]](
    changing(_.appearancePack): v =>
      pref => ThemePacks.get(v).fold(pref)(pack => pref.copy(appearance = pack.appearance)),
    changing(_.uiTheme): v =>
      changeAppearance(_.copy(uiTheme = v)),
    changing(_.background): v =>
      changeAppearance: appearance =>
        appearance.copy(
          background = v,
          backgroundUrl = Option.when(v == Backgrounds.customKey)(appearance.backgroundUrl).flatten
        ),
    changing(_.backgroundUrl): v =>
      changeAppearance(
        _.copy(
          background = Backgrounds.customKey,
          backgroundUrl = v.some.filterNot(_.isBlank)
        )
      ),
    changing(_.boardTheme): v =>
      changeAppearance(_.copy(boardTheme = v)),
    changing(_.pieceSet): v =>
      changeAppearance(_.copy(pieceSet = v)),
    changing(_.soundSet): v =>
      changeAppearance(_.copy(soundSet = v)),
    changing(_.musicSet): v =>
      changeAppearance(_.copy(musicSet = v)),
    changing(_.zen): v =>
      _.copy(zen = v),
    changing(_.voice): v =>
      _.copy(voice = v.some),
    changing(_.keyboardMove): v =>
      _.copy(keyboardMove = v | Pref.KeyboardMove.NO),
    changing(_.autoQueen): v =>
      _.copy(autoQueen = v),
    changing(_.premove): v =>
      _.copy(premove = v == 1),
    changing(_.takeback): v =>
      _.copy(takeback = v),
    changing(_.autoThreefold): v =>
      _.copy(autoThreefold = v),
    changing(_.submitMove): v =>
      _.copy(submitMove = v),
    changing(_.confirmResign): v =>
      _.copy(confirmResign = v),
    changing(_.moretime): v =>
      _.copy(moretime = v),
    changing(_.clockTenths): v =>
      _.copy(clockTenths = v),
    changing(_.clockSound): v =>
      _.copy(clockSound = v == 1),
    changing(_.pieceNotation): v =>
      _.copy(pieceNotation = v),
    changing(_.ratings): v =>
      _.copy(ratings = v),
    changing(_.follow): v =>
      _.copy(follow = v == 1),
    changing(_.challenge): v =>
      _.copy(challenge = v),
    changing(_.message): v =>
      _.copy(message = v),
    changing(_.board.brightness): v =>
      changeAppearance(appearance => appearance.copy(board = appearance.board.copy(brightness = v))),
    changing(_.board.contrast): v =>
      changeAppearance(appearance => appearance.copy(board = appearance.board.copy(contrast = v))),
    changing(_.board.opacity): v =>
      changeAppearance(appearance => appearance.copy(board = appearance.board.copy(opacity = v))),
    changing(_.board.hue): v =>
      changeAppearance(appearance => appearance.copy(board = appearance.board.copy(hue = v))),
    changing(_.sayGG): v =>
      _.copy(sayGG = v)
  ).map: change =>
    change.field -> change
  .toMap
