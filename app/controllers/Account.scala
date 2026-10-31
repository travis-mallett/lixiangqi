package controllers

import cats.mtl.Handle.*
import play.api.data.Form
import play.api.libs.json.*
import play.api.mvc.*
import views.account.pages

import lila.app.{ *, given }
import lila.common.HTTPRequest
import lila.core.id.SessionId
import lila.security.SecurityForm.Reopen
import lila.core.user.KidMode
import lila.security.IsPwned
import lila.core.security.ClearPassword
import lila.core.net.ValidReferrer

final class Account(
    env: Env,
    auth: Auth,
    apiC: => Api
) extends LilaController(env):

  private given (using Context): Option[ValidReferrer] = env.web.referrerRedirect.fromReq

  def profile = AuthOrScoped(_.Preference.Write) { _ ?=> me ?=>
    Ok.page:
      pages.profile(me, env.user.forms.profileOf(me))
  }

  def username = Auth { _ ?=> me ?=>
    Ok.page:
      pages.username(me, env.user.forms.usernameOf(me))
  }

  def profileApply = AuthOrScopedBody(_.Web.Mobile, _.Preference.Write) { _ ?=> me ?=>
    bindForm(env.user.forms.profile)(
      err =>
        negotiate(
          BadRequest.page(pages.profile(me, err)),
          jsonFormError(err)
        ),
      profile =>
        for
          _ <- profile.bio
            .exists(env.security.spam.detect)
            .option("profile.bio" -> ~profile.bio)
            .orElse:
              profile.links.exists(env.security.spam.detect).option("profile.links" -> ~profile.links)
            .so: (resource, text) =>
              env.report.api.autoCommFlag(lila.report.Suspect(me).id, resource, text)
          _ <- env.user.repo.setProfile(me, profile)
          flairForm = env.user.forms.flair(asMod = isGranted(_.LichessTeam))
          _ <- bindForm(flairForm)(_ => funit, env.user.repo.setFlair(me, _))
        yield
          env.user.lightUserApi.invalidate(me)
          if ctx.isOAuth then Ok(Json.obj("ok" -> true))
          else Redirect(routes.User.show(me.username)).flashSuccess
    )
  }

  def usernameApply = AuthBody { _ ?=> me ?=>
    FormFuResult(env.user.forms.username(me))(err => renderPage(pages.username(me, err))): username =>
      env.user.repo
        .setUsernameCased(me, username)
        .inject(Redirect(routes.User.show(me.username)).flashSuccess)
        .recover: e =>
          Redirect(routes.Account.username).flashFailure(e.getMessage)
  }

  def info = Auth { ctx ?=> me ?=>
    if !HTTPRequest.isLichobile(req)
    then notFoundJson()
    else
      negotiateJson:
        for
          povs <- env.round.proxyRepo.urgentGames(me)
          nbChallenges <- env.challenge.api.countInFor.get(me)
          playban <- env.playban.api.currentBan(me)
        yield Ok:
          env.user.jsonView
            .full(me, none, withProfile = false) ++ Json
            .obj(
              "prefs" -> lila.pref.toJson(ctx.pref, lichobileCompat = true),
              "nowPlaying" -> JsArray(povs.value.take(50).map(env.api.lobbyApi.nowPlaying)),
              "nbChallenges" -> nbChallenges,
              "online" -> true
            )
            .add("kid" -> ctx.kid)
            .add("troll" -> me.marks.troll)
            .add("playban" -> playban)
            .add("announce" -> env.web.lichobileAnnounceApi.get)
        .headerCacheSeconds(15)
  }

  def nowPlaying = Auth { _ ?=> _ ?=>
    negotiateJson(doNowPlaying)
  }

  val apiMe = Scoped() { ctx ?=> me ?=>
    def limited = rateLimited:
      "Please don't poll this endpoint. Stream https://lixiangqi.org/api#tag/board/GET/api/stream/event instead."
    val wikiGranted = getBool("wiki") && isGranted(_.LichessTeam) && ctx.scopes.has(_.Web.Mod)
    if getBool("wiki") && !wikiGranted then Unauthorized(jsonError("Wiki access not granted"))
    else
      limit.apiMe(me, limited):
        env.api.userApi
          .extended(
            me.value,
            lila.api.UserApi.Opts(
              withTrophies = false,
              withCanChallenge = false,
              withPlayban = getBool("playban"),
              forWiki = wikiGranted
            )
          )
          .dmap { JsonOk(_) }
  }

  def apiNowPlaying = Scoped()(doNowPlaying)

  private def doNowPlaying(using ctx: Context)(using me: Me) =
    for
      all <- env.round.proxyRepo.urgentGames(me)
      kingdoms <- env.threeKingdoms.repo.activeFor(me.userId)
      selected = all.value.take((getInt("nb") | 9).atMost(50))
      povs = selected.map(env.api.lobbyApi.nowPlaying)
    yield Ok:
      Json.obj(
        "nowPlaying" -> JsArray(povs),
        "kingdomsPlaying" -> kingdoms.map(env.threeKingdoms.json.preview(_, me.userId)),
        "nbNowPlaying" -> (all.value.size + kingdoms.size),
        "nbMyTurn" -> (all.value.count(_.isMyTurn) + kingdoms.count(g =>
          g.playerOf(me.userId).contains(g.position.turn)
        ))
      )

  def dasher = Auth { _ ?=> me ?=>
    negotiateJson:
      env.pref.api
        .get(me)
        .map: prefs =>
          Ok:
            lila.common.Json.lightUser.write(me.light) ++ Json.obj(
              "coach" -> isGranted(_.Coach),
              "prefs" -> lila.pref.toJson(prefs, lichobileCompat = false)
            )
  }

  def passwd = Auth { ctx ?=> me ?=>
    if !env.security.externalLogin.confirmed(me.userId) then
      Redirect(routes.ExternalAuth.reauthenticate(Some(routes.Account.passwd.url))).toFuccess
    else
      env.security.externalIdentities
        .hasPassword(me.userId)
        .flatMap: hasPassword =>
          Ok.page(pages.password(env.security.forms.passwdResetForMe, hasPassword))
  }

  def passwdApply = AuthBody { ctx ?=> me ?=>
    if !env.security.externalLogin.confirmed(me.userId) then
      Redirect(routes.ExternalAuth.reauthenticate(Some(routes.Account.passwd.url))).toFuccess
    else
      auth.HasherRateLimit:
        env.security.externalIdentities
          .hasPassword(me.userId)
          .flatMap: hasPassword =>
            FormFuResult(env.security.forms.passwdResetForMe)(err =>
              renderPage(pages.password(err, hasPassword))
            ): data =>
              val newPass = ClearPassword(data.newPasswd1)
              for
                _ <- env.security.authenticator.setPassword(me, newPass)
                _ <- env.mod.logApi.setPassword
                pwned <- env.security.pwned.isPwned(newPass)
                res <- refreshSessionId(Redirect(routes.ExternalAuth.index).flashSuccess, pwned)
              yield res
  }

  private def refreshSessionId(result: Result, pwned: IsPwned)(using ctx: Context, me: Me): Fu[Result] = for
    _ <- env.security.store.closeAllSessionsOf(me)
    _ <- env.push.browserSub.unsubscribeByUser(me)
    _ <- env.push.unregisterDevices(me)
    sessionId <- env.security.api.saveAuthentication(me, ctx.mobileApiVersion, pwned)
  yield result.withCookies(env.security.lilaCookie.session(env.security.api.sessionIdKey, sessionId.value))

  private def emailForm(using me: Me, ctx: Context) =
    env.user.repo.email(me).flatMap(env.security.forms.changeEmail)

  def email = Auth { _ ?=> me ?=>
    if getBool("check")
    then Ok.page(renderCheckYourEmail).map(_.hasPersonalData)
    else
      for
        f <- emailForm
        managed <- env.clas.api.student.isManaged(me)
        res <- Ok.page(pages.email(f, managed))
      yield res.hasPersonalData
  }

  def apiEmail = Scoped(_.Email.Read) { _ ?=> me ?=>
    Found(env.user.repo.email(me)): email =>
      JsonOk(Json.obj("email" -> email.value))
  }

  def renderCheckYourEmail(using Context, Option[ValidReferrer]) =
    views.auth.checkYourEmail(lila.security.EmailConfirm.cookie.get(ctx.req).map(_.email))

  def emailApply = AuthBody { ctx ?=> me ?=>
    auth.HasherRateLimit:
      for
        _ <- env.security.forms.preloadEmailDns()
        form <- emailForm
        managed <- env.clas.api.student.isManaged(me)
        res <- FormFuResult(form)(err => renderPage(pages.email(err, managed))): data =>
          val newUserEmail = lila.security.EmailConfirm.UserEmail(me.username, data.email)
          auth.EmailConfirmRateLimit(newUserEmail, ctx.req, rateLimited):
            env.security.emailChange
              .send(me, newUserEmail.email)
              .inject(Redirect(routes.Account.email).flashSuccess:
                lila.core.i18n.I18nKey.site.checkYourEmail.txt())
      yield res
  }

  def emailConfirm(token: String) = Open:
    Found(env.security.emailChange.confirm(token)): (me, prevEmail, newEmail) =>
      given Me = me
      for
        _ <- prevEmail.exists(_.isNoReply).so(env.clas.api.student.release(me))
        _ <- env.mod.logApi.setEmail(me.userId, prevEmail, newEmail)
        res <- auth.authenticateUser(
          me,
          pwned = IsPwned.No,
          remember = true,
          result =
            if prevEmail.exists(_.isNoReply)
            then Redirect(routes.User.show(me.username)).flashSuccess.some
            else Redirect(routes.Account.email).flashSuccess.some
        )
      yield res

  def emailConfirmHelp = OpenBody:
    import lila.security.EmailConfirm.Help.*
    ctx.me match
      case Some(me) =>
        Redirect(routes.User.show(me.username))
      case None if get("username").isEmpty =>
        Ok.page(views.account.security.emailConfirmHelp(helpForm, none))
      case None =>
        bindForm(helpForm)(
          err => BadRequest.page(views.account.security.emailConfirmHelp(err, none)),
          username =>
            getStatus(env.user.api, env.user.repo, username).flatMap: status =>
              Ok.page(views.account.security.emailConfirmHelp(helpForm.fill(username), status.some))
        )

  def twoFactor = Auth { _ ?=> me ?=>
    if me.totpSecret.isDefined then
      env.security.forms.disableTwoFactor.flatMap: f =>
        Ok.page(views.account.twoFactor.disable(f))
    else
      env.security.forms.setupTwoFactor.flatMap: f =>
        Ok.page(views.account.twoFactor.setup(f))
  }

  def setupTwoFactor = AuthBody { ctx ?=> me ?=>
    auth.HasherRateLimit:
      env.security.forms.setupTwoFactor.flatMap: form =>
        FormFuResult(form)(err => renderPage(views.account.twoFactor.setup(err))): data =>
          for
            _ <- env.user.repo.setupTwoFactor(me, lila.user.TotpSecret.decode(data.secret))
            res <- refreshSessionId(Redirect(routes.Account.twoFactor).flashSuccess, pwned = IsPwned.No)
          yield res
  }

  def disableTwoFactor = AuthBody { ctx ?=> me ?=>
    auth.HasherRateLimit:
      env.security.forms.disableTwoFactor.flatMap: form =>
        FormFuResult(form)(err => renderPage(views.account.twoFactor.disable(err))): _ =>
          env.user.repo.disableTwoFactor(me).inject(Redirect(routes.Account.twoFactor).flashSuccess)
  }

  def close = Auth { _ ?=> me ?=>
    for
      managed <- env.clas.api.student.isManaged(me)
      form <- env.security.forms.closeAccount
      res <- Ok.page(pages.close(form, managed))
    yield res
  }

  def closeConfirm = AuthBody { ctx ?=> me ?=>
    NotManaged:
      auth.HasherRateLimit:
        env.security.forms.closeAccount.flatMap: form =>
          FormFuResult(form)(err => renderPage(pages.close(err, managed = false))): forever =>
            for _ <- env.api.accountTermination.disable(me.value, forever = forever)
            yield Redirect(routes.Lobby.home).withCookies(env.security.lilaCookie.newSession)
  }

  def delete = Auth { _ ?=> me ?=>
    for
      managed <- env.clas.api.student.isManaged(me)
      form <- env.security.forms.deleteAccount
      res <- Ok.page(pages.delete(form, managed))
    yield res
  }

  def deleteConfirm = AuthBody { ctx ?=> me ?=>
    NotManaged:
      auth.HasherRateLimit:
        env.security.forms.deleteAccount.flatMap: form =>
          FormFuResult(form)(err => renderPage(pages.delete(err, managed = false))): _ =>
            for _ <- env.api.accountTermination.scheduleDelete(me.value)
            yield Redirect(routes.Account.deleteDone).withCookies(env.security.lilaCookie.newSession)
  }

  def deleteDone = Open { ctx ?=>
    if ctx.isAuth then Redirect(routes.Lobby.home)
    else FoundPage(env.cms.renderKey("delete-done"))(views.cms.lone)
  }

  def kid = Auth { _ ?=> me ?=>
    for
      managed <- env.clas.api.student.isManaged(me)
      form <- env.security.forms.toggleKid
      content <- env.cms.renderKey("kid-mode")
      page <- Ok.page(pages.kid(me, form, managed, content.map(_.html)))
    yield page
  }
  def apiKid = Scoped(_.Preference.Read) { _ ?=> me ?=>
    JsonOk(Json.obj("kid" -> me.kid.yes))
  }

  def kidPost = AuthBody { ctx ?=> me ?=>
    NotManaged:
      env.security.forms.toggleKid.flatMap: form =>
        bindForm(form)(
          err =>
            negotiate(
              for
                content <- env.cms.renderKey("kid-mode")
                page <- BadRequest.page(pages.kid(me, err, managed = false, content.map(_.html)))
              yield page,
              BadRequest(errorsAsJson(err))
            ),
          _ =>
            for
              _ <- env.user.api.setKid(me, getBoolAs[KidMode]("v"))
              res <- negotiate(Redirect(routes.Account.kid).flashSuccess, jsonOkResult)
            yield res
        )
  }

  def apiKidPost = Scoped(_.Preference.Write) { ctx ?=> me ?=>
    getBoolOptAs[KidMode]("v") match
      case None => BadRequest(jsonError("Missing v parameter"))
      case Some(v) => env.user.api.setKid(me, v).inject(jsonOkResult)
  }

  // Kids clients can enable protection, but cannot use this permission to disable it.
  def apiKidEnable = Scoped(_.Kid.Enable) { _ ?=> me ?=>
    env.user.api.setKid(me, KidMode.Yes).inject(JsonOk(Json.obj("kid" -> true)))
  }

  def apiKidsAvatar = Scoped(_.Kid.Enable) { _ ?=> me ?=>
    if !me.kid.yes then fuccess(Forbidden(jsonError("kid_mode_required")))
    else env.puzzle.kidsAvatar.get(me.userId).map(JsonOk(_))
  }

  def apiKidsAvatarEquip = ScopedBody(parse.json(maxLength = 4096))(Seq(_.Kid.Enable)) { ctx ?=> me ?=>
    if !me.kid.yes then fuccess(Forbidden(jsonError("kid_mode_required")))
    else
      val body = ctx.body.body
      ((body \ "revision").asOpt[Long], (body \ "appearance").asOpt[Map[String, String]]) match
        case (Some(revision), Some(appearance)) =>
          env.puzzle.kidsAvatar.equip(me.userId, revision, appearance).map {
            case Right(state) => JsonOk(state)
            case Left(error) => Conflict(jsonError(error))
          }
        case _ => fuccess(BadRequest(jsonError("invalid_request")))
  }

  def apiKidsAvatarPurchase = ScopedBody(parse.json(maxLength = 1024))(Seq(_.Kid.Enable)) { ctx ?=> me ?=>
    if !me.kid.yes then fuccess(Forbidden(jsonError("kid_mode_required")))
    else
      val body = ctx.body.body
      (
        (body \ "itemId").asOpt[String],
        (body \ "requestId").asOpt[String],
        (body \ "catalogVersion").asOpt[Int]
      ) match
        case (Some(item), Some(request), Some(version)) =>
          env.puzzle.kidsAvatar.purchase(me.userId, item, request, version).map {
            case Right(state) => JsonOk(state)
            case Left(error) => Conflict(jsonError(error))
          }
        case _ => fuccess(BadRequest(jsonError("invalid_request")))
  }

  def security = Auth { _ ?=> me ?=>
    for
      _ <- env.security.api.dedup(me, req)
      sessions <- env.security.api.locatedOpenSessions(me, 50)
      clients <- env.oAuth.tokenApi.listClients(50)
      personalAccessTokens <- env.oAuth.tokenApi.countPersonal
      currentSessionId = env.security.api.reqSessionId(req)
      page <- Ok.async:
        views.account.security(me, sessions, currentSessionId, clients, personalAccessTokens)
    yield page.hasPersonalData
  }

  def signout(sessionId: String) = Auth { _ ?=> me ?=>
    if sessionId == "all"
    then refreshSessionId(Redirect(routes.Account.security).flashSuccess, pwned = IsPwned.No)
    else
      for
        _ <- env.security.store.closeUserAndSessionId(me, SessionId(sessionId))
        _ <- env.push.browserSub.unsubscribeBySession(SessionId(sessionId))
      yield NoContent
  }

  private def renderReopen(form: Option[Form[Reopen]], msg: Option[String])(using Context) =
    pages.reopen.form(form | env.security.forms.reopen, msg)

  def reopen = Open:
    auth.RedirectToProfileIfLoggedIn:
      Ok.async(renderReopen(none, none))

  def reopenApply = OpenBody:
    env.security.turnstile.verify().flatMap {
      if _ then
        env.security.forms.reopen
          .bindFromRequest()
          .fold(
            err => BadRequest.async(renderReopen(err.some, none)),
            data =>
              allow:
                env.security.reopen
                  .prepare(data.username, data.email, env.mod.logApi.closedByMod)
                  .flatMap: user =>
                    env.security.loginToken.rateLimit[Result](user, data.email, ctx.req, rateLimited):
                      lila.mon.user.auth.reopenRequest("success").increment()
                      env.security.reopen
                        .send(user, data.email)
                        .inject(Redirect(routes.Account.reopenSent))
              .rescue: (code, msg) =>
                lila.mon.user.auth.reopenRequest(code).increment()
                BadRequest.async(renderReopen(none, msg.some))
          )
      else BadRequest.async(renderReopen(none, none))
    }

  def reopenSent = Open:
    Ok.page(pages.reopen.sent)

  def reopenLogin(token: String) = Open:
    env.security.reopen
      .confirm(token)
      .flatMap:
        case None =>
          lila.mon.user.auth.reopenConfirm("token_fail").increment()
          notFound
        case Some(user) =>
          for
            _ <- env.report.api.reopenReports(lila.report.Suspect(user))
            result <- auth.authenticateUser(user, remember = true, pwned = IsPwned.No)
            _ = lila.mon.user.auth.reopenConfirm("success").increment()
          yield result

  def data = Auth { _ ?=> me ?=>
    meOrFetch(getUserStr("user"))
      .map:
        _.filter(u => ctx.is(u) || isGrantedOpt(_.Impersonate))
      .orNotFound: user =>
        if getBool("text") then
          apiC.GlobalConcurrencyLimitUser(me)(env.api.personalDataExport(user)): source =>
            Ok.chunked(source.map(_ + "\n")).asAttachmentStream(s"lichess_${user.username}.txt")
        else Ok.page(pages.data(user))
  }
