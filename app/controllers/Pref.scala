package controllers

import play.api.mvc.*
import play.api.libs.json.*

import lila.app.{ *, given }
import lila.common.HTTPRequest
import lila.notify.NotificationPref
import lila.common.Json.given

final class Pref(env: Env) extends LilaController(env):

  private def api = env.pref.api
  private def forms = lila.pref.PrefForm

  def apiGet = Scoped(_.Preference.Read, _.Web.Mobile, _.Web.Takex3) { _ ?=> me ?=>
    env.pref.api.get(me).map { prefs =>
      JsonOk:
        Json
          .obj("prefs" -> lila.pref.toJson(prefs, lichobileCompat = false))
          .add("language" -> me.lang) ++ Json.obj(
          "catalogs" -> Json.obj(
            "uiTheme" -> lila.pref.UiThemes.all.map(t => Json.obj("key" -> t.key, "name" -> t.name)),
            "background" -> lila.pref.Backgrounds.all.map(t => Json.obj("key" -> t.key, "name" -> t.name)),
            "boardTheme" -> lila.pref.BoardThemes.all.map(t => Json.obj("key" -> t.key, "name" -> t.name)),
            "pieceSet" -> lila.pref.PieceSets.all.map(t => Json.obj("key" -> t.key, "name" -> t.name)),
            "soundSet" -> lila.pref.SoundSets.all.map(t => Json.obj("key" -> t.key, "name" -> t.name)),
            "musicSet" -> lila.pref.MusicSets.all.map(t => Json.obj("key" -> t.key, "name" -> t.name)),
            "language" -> lila.i18n.LangList.allChoices
              .map((key, name) => Json.obj("key" -> key, "name" -> name))
          )
        )
    }
  }

  private val redirects = Map(
    "game-display" -> "display",
    "site" -> "privacy"
  )

  def form(categSlug: String) =
    redirects.get(categSlug) match
      case Some(redir) => Action(Redirect(routes.Pref.form(redir)))
      case None =>
        Auth { ctx ?=> me ?=>
          lila.pref.PrefCateg(categSlug) match
            case None if categSlug == "notification" =>
              Ok.async:
                env.notifyM.api.prefs
                  .form(me)
                  .map:
                    views.account.pref.notification(_)
            case None => notFound
            case Some(categ) => Ok.page(views.account.pref(me, forms.prefOf(ctx.pref), categ))
        }

  def formApply = AuthBody { ctx ?=> me ?=>
    def onSuccess(data: lila.pref.PrefForm.PrefData) =
      api.setPref(me, data(ctx.pref)).inject(Ok("saved"))
    val form = forms.pref(lichobile = HTTPRequest.isLichobile(req))
    bindForm(form)(
      _ =>
        form
          .bindFromRequest(lila.pref.FormCompatLayer(ctx.pref, ctx.body))
          .fold(
            err => BadRequest(err.toString).toFuccess,
            onSuccess
          ),
      onSuccess
    )
  }

  def notifyFormApply = AuthBody { ctx ?=> me ?=>
    bindForm(NotificationPref.form.form)(
      err => BadRequest(err.toString).toFuccess,
      data => env.notifyM.api.prefs.set(me, data).inject(Ok("saved"))
    )
  }

  def set(name: String) = OpenBody:
    if name == "zoom"
    then Ok.withCookies(env.security.lilaCookie.cookie("zoom", (getInt("v") | 85).toString))
    else if name == "agreement" then
      for _ <- ctx.me.so(api.agree(_))
      yield if HTTPRequest.isXhr(ctx.req) then NoContent else Redirect(routes.Lobby.home)
    else
      lila.pref.PrefSingleChange.changes
        .get(name)
        .so: change =>
          bindForm(change.form)(
            form => fuccess(BadRequest(form.errors.flatMap(_.messages).mkString("\n"))),
            v =>
              val cookie =
                if lila.pref.Appearance.sessionKeys.contains(name) then
                  val appearance = change.update(v)(ctx.pref).appearance
                  env.security.lilaCookie.withSession(remember = true): session =>
                    lila.pref.Appearance.sessionKeys.foldLeft(session)(_ - _) ++ appearance.sessionValues
                else env.security.lilaCookie.session(name, v.toString)
              for _ <- ctx.me.so(api.setPref(_, change.update(v)))
              yield Ok(()).withCookies(cookie)
          )

  def apiSet(name: String) = ScopedBody(_.Web.Mobile, _.Preference.Write) { ctx ?=> me ?=>
    if name == "language" then
      bindForm(lila.i18n.LangForm.select)(
        jsonFormError,
        code => env.user.repo.setLang(me, lila.i18n.LangPicker.byStr(code).get).inject(NoContent)
      )
    else
      lila.pref.PrefSingleChange.changes
        .get(name)
        .so: change =>
          bindForm(change.form)(
            jsonFormError,
            v => api.setPref(me, change.update(v)).inject(NoContent)
          )
  }

  def apiNotifications = Scoped(_.Preference.Read) { _ ?=> me ?=>
    env.notifyM.api.prefs.form(me).map(form => JsonOk(Json.toJson(form.data)))
  }

  def apiNotificationsApply(name: String) = ScopedBody(_.Preference.Write) { ctx ?=> me ?=>
    val fixed = Set("privateMessage.bell", "challenge.bell", "tournamentSoon.bell", "gameEvent.bell")
    env.notifyM.api.prefs
      .form(me)
      .flatMap: current =>
        if !current.data.contains(name) || fixed(name) then
          BadRequest(jsonError("invalid_preference")).toFuccess
        else
          bindForm(play.api.data.Form(play.api.data.Forms.single("v" -> play.api.data.Forms.boolean)))(
            jsonFormError,
            v =>
              NotificationPref.form.form
                .bind(current.data.updated(name, v.toString))
                .fold(
                  jsonFormError,
                  data => env.notifyM.api.prefs.set(me, data).inject(NoContent)
                )
          )
  }

  def network = Auth { ctx ?=> me ?=>
    Ok.page(views.account.pref.network(ctx.pref.isUsingAltSocket))
  }

  def networkPost = AuthBody { ctx ?=> me ?=>
    for _ <- bindForm(forms.cfRoutingForm)(
        _ => funit,
        cfRouting => env.pref.api.setPref(me, ctx.pref.copy(usingAltSocket = cfRouting.some))
      )
    yield Redirect(routes.Pref.network)
  }
