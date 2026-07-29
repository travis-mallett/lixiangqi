package lila.pref
package ui

import play.api.libs.json.*

import lila.common.Json.given
import lila.core.perm.Granter
import lila.ui.Context

object DasherJson:

  def apply(pref: Pref)(using ctx: Context): JsObject =
    import Backgrounds.given
    import BoardThemes.given
    import MusicSets.given
    import PieceSets.given
    import SoundSets.given
    import ThemePacks.given
    import UiThemes.given
    Json.obj(
      "user" -> ctx.me.map(_.light),
      "appearance" -> Json.obj(
        "current" -> pref.appearance,
        "packs" -> ThemePacks.all,
        "uiThemes" -> UiThemes.all,
        "backgrounds" -> Backgrounds.all,
        "boards" -> BoardThemes.all,
        "pieceSets" -> PieceSets.all,
        "soundSets" -> SoundSets.all,
        "musicSets" -> MusicSets.all
      ),
      "coach" -> Granter.opt(_.Coach)(using ctx.me)
    )
