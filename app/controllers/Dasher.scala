package controllers

import play.api.libs.json.*
import lila.app.{ *, given }
import lila.i18n.{ LangList, LangPicker }
import lila.pref.ui.DasherJson

final class Dasher(env: Env) extends LilaController(env):

  def get = Open:
    negotiateJson:
      ctx.me
        .so(env.streamer.api.isPotentialStreamer(_))
        .map: isStreamer =>
          Ok:
            Json.obj(
              "lang" -> Json.obj(
                "current" -> ctx.lang.code,
                "accepted" -> LangPicker.allFromRequestHeaders(ctx.req).map(_.code),
                "list" -> LangList.allChoices
              ),
              "streamer" -> isStreamer
            ) ++ DasherJson(ctx.pref)
