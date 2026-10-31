package controllers

import play.api.data.Form
import play.api.data.Forms.*
import play.api.mvc.*

import lila.app.*
import lila.security.{ IsPwned, LoginCandidate, PasswordAndToken }
import lila.security.ExternalLogin.*
import lila.core.security.ClearPassword
import lila.memo.RateLimit
import lila.core.net.IpAddress

final class ExternalAuth(env: Env, auth: Auth) extends LilaController(env):
  private given lila.core.config.RateLimit = env.net.rateLimit
  private def service = env.security.externalLogin
  private def identities = env.security.externalIdentities
  private def ui = views.externalAuth
  private val attempts = RateLimit[IpAddress](credits = 20, duration = 10.minutes, key = "externalLogin.ip")
  private val tokens = Form(single("token" -> optional(text)))
  private val passwordForm = Form(tuple("password" -> text, "token" -> optional(text)))

  private def browser(using ctx: Context) = ctx.req.cookies.get(cookieName).map(_.value)
  private def session(using ctx: Context) = ctx.req.session.get("sessionId").getOrElse("")
  private def failure(using Context) = BadRequest.page(ui.error)

  def start(provider: String) = OpenBody:
    Firewall:
      attempts(ctx.ip, rateLimited):
        if ctx.isAuth then Redirect(routes.ExternalAuth.index).toFuccess
        else
          val destination = env.web.referrerRedirect.fromReq.fold("/"): ref =>
            val uri = java.net.URI.create(ref.value)
            uri.getRawPath + Option(uri.getRawQuery).fold("")("?" + _) + Option(uri.getRawFragment).fold("")(
              "#" + _
            )
          begin(provider, Purpose.Login, destination)

  // Called only after OAuth has parsed the authorization request. The return target
  // is that local request, never an arbitrary redirect supplied by a provider.
  def loginForOAuth(provider: String, returnTo: String)(using ctx: Context): Fu[Result] =
    Firewall:
      attempts(ctx.ip, rateLimited):
        begin(provider, Purpose.Login, returnTo)

  private def begin(provider: String, purpose: Purpose, returnTo: String)(using Context): Fu[Result] =
    service
      .provider(provider)
      .fold(notFound): p =>
        val binding = random()
        fuccess(
          Redirect(service.begin(p, binding, purpose, returnTo)).withCookies(
            env.security.lilaCookie.cookie(cookieName, binding, maxAge = Some(600), httpOnly = Some(true))
          )
        )

  def callback(provider: String) = Open:
    Firewall:
      attempts(ctx.ip, rateLimited):
        (for
          p <- service.provider(provider)
          binding <- browser
          state <- get("state").filter(_.length <= 128)
          code <- get("code").filter(c => c.nonEmpty && c.length <= 4096)
        yield service
          .complete(p, binding, state, code)
          .flatMap: pending =>
            if pending.purpose.isInstanceOf[Purpose.Native] then
              val Purpose.Native(id) = pending.purpose: @unchecked
              if service.nativeComplete(id, pending.identity) then Ok.page(ui.nativeComplete)
              else failure
            else if !validPurpose(pending.purpose) then
              service.reportFailure(provider, Failed(Stage.Session, Reason.PurposeMismatch))
              failure
            else
              service.savePending(binding, pending)
              Redirect(routes.ExternalAuth.finish).toFuccess
        ).getOrElse {
          service.reportFailure(provider, Failed(Stage.Callback, Reason.MissingParameters))
          failure
        }.recoverWith:
          case failed: Failed =>
            service.reportFailure(provider, failed)
            failure
          case scala.util.control.NonFatal(_) =>
            service.reportFailure(provider, Failed())
            failure

  private def validPurpose(purpose: Purpose)(using ctx: Context): Boolean = purpose match
    case Purpose.Native(id) => service.nativeExists(id)
    case Purpose.Login => !ctx.isAuth
    case Purpose.Link(user, original) => ctx.is(user) && session == original && service.confirmed(user)
    case Purpose.Confirm(user, original) => ctx.is(user) && session == original

  def finish = Open:
    Firewall:
      withPending: (binding, pending) =>
        identities
          .owner(pending.identity.key)
          .flatMap:
            case None if pending.purpose == Purpose.Login =>
              val referrer =
                java.net.URLEncoder.encode(pending.returnTo, java.nio.charset.StandardCharsets.UTF_8)
              Redirect(s"${routes.Auth.signup.url}?referrer=$referrer").toFuccess
            case owner =>
              target(pending, owner).flatMap:
                case Some(user) if user.enabled.yes =>
                  if user.totpSecret.isDefined then Ok.page(ui.twoFactor(tokens))
                  else complete(binding, pending, user, None)
                case _ if pending.purpose.isInstanceOf[Purpose.Confirm] =>
                  BadRequest.page(ui.verificationFailed(pending.returnTo))
                case _ => failure

  def finishPost = OpenBody:
    Firewall:
      attempts(ctx.ip, rateLimited):
        withPending: (binding, pending) =>
          identities
            .owner(pending.identity.key)
            .flatMap: owner =>
              target(pending, owner).flatMap:
                case Some(user) if user.enabled.yes =>
                  tokens
                    .bindFromRequest()
                    .fold(_ => failure, token => complete(binding, pending, user, token))
                case _ => failure

  private def withPending(f: (String, Pending) => Fu[Result])(using Context): Fu[Result] =
    (for
      binding <- browser
      pending <- service.getPending(binding).filter(p => validPurpose(p.purpose))
    yield f(binding, pending)).getOrElse(failure)

  private def target(pending: Pending, owner: Option[UserModel]): Fu[Option[UserModel]] =
    pending.purpose match
      case Purpose.Login => fuccess(owner)
      case Purpose.Native(_) => fuccess(None)
      case Purpose.Confirm(user, _) => fuccess(owner.filter(_.id == user))
      case Purpose.Link(user, _) =>
        if owner.exists(_.id != user) then fuccess(None) else env.user.repo.byId(user)

  private def complete(binding: String, pending: Pending, user: UserModel, token: Option[String])(using
      ctx: Context
  ): Fu[Result] =
    env.security.api
      .checkExternalLogin(user, token)
      .flatMap:
        case LoginCandidate.Result.Success(_) =>
          if !service.takePending(binding).contains(pending) then failure
          else
            val result: Fu[Result] = pending.purpose match
              case Purpose.Native(_) => failure
              case Purpose.Login =>
                auth.authenticateUser(user, IsPwned.No, remember = true, Some(Redirect(pending.returnTo)))
              case Purpose.Link(id, _) =>
                env.user.repo
                  .isManaged(id)
                  .flatMap:
                    case true => failure
                    case false =>
                      identities
                        .link(id, pending.identity.key)
                        .flatMap:
                          case true => Redirect(routes.ExternalAuth.index).flashSuccess.toFuccess
                          case false => failure
              case Purpose.Confirm(id, _) =>
                service.confirm(id)
                Redirect(pending.returnTo).toFuccess
            result.map(_.discardingCookies(env.security.lilaCookie.discard(cookieName)))
        case LoginCandidate.Result.MissingTotpToken | LoginCandidate.Result.InvalidTotpToken =>
          BadRequest.page(ui.twoFactor(tokens.withGlobalError("invalidAuthenticationCode")))
        case _ => failure

  def index = Auth { ctx ?=> me ?=>
    for
      linked <- identities.list(me.userId)
      managed <- env.user.repo.isManaged(me.userId)
      password <- identities.hasPassword(me.userId)
      result <- Ok.page(ui.index(service.providers, linked, password, managed))
    yield result
  }

  def nativeStart(id: String) = Open:
    attempts(ctx.ip, rateLimited):
      service
        .nativeLaunch(id)
        .fold(failure): attempt =>
          begin(attempt.provider, Purpose.Native(id), "/")

  def link(provider: String) = startChange(provider, unlink = false)
  def unlink(provider: String) = startChange(provider, unlink = true)

  private def startChange(provider: String, unlink: Boolean) = AuthBody { ctx ?=> me ?=>
    attempts(ctx.ip, rateLimited):
      env.user.repo
        .isManaged(me.userId)
        .flatMap:
          case true => failure
          case false =>
            service
              .provider(provider)
              .fold(failure): _ =>
                val id = service.saveChange(me.userId, session, provider, unlink)
                Redirect(routes.ExternalAuth.change(id)).toFuccess
  }

  def change(id: String) = Auth { ctx ?=> me ?=>
    service
      .getChange(id, me.userId, session)
      .fold(failure): change =>
        if !service.confirmed(me.userId) then
          Redirect(routes.ExternalAuth.reauthenticate(Some(routes.ExternalAuth.change(id).url))).toFuccess
        else
          service
            .provider(change.provider)
            .fold(failure): provider =>
              if change.unlink then
                for
                  linked <- identities.list(me.userId)
                  password <- identities.hasPassword(me.userId)
                  result <-
                    if !linked.exists(_.startsWith(s"${provider.id}:")) then failure
                    else if !password && linked.size <= 1 then BadRequest.page(ui.lastMethod)
                    else
                      Ok.page(
                        ui.confirmUnlink(
                          id,
                          provider.name,
                          password,
                          service.providers
                            .filter(p => p.id != provider.id && linked.exists(_.startsWith(s"${p.id}:")))
                            .map(_.name)
                        )
                      )
                yield result
              else
                env.user.repo
                  .isManaged(me.userId)
                  .flatMap:
                    case true => failure
                    case false =>
                      service
                        .takeChange(id, me.userId, session)
                        .fold(failure): _ =>
                          begin(provider.id, Purpose.Link(me.userId, session), routes.ExternalAuth.index.url)
  }

  def changeApply(id: String) = AuthBody { ctx ?=> me ?=>
    if !service.confirmed(me.userId) then
      Redirect(routes.ExternalAuth.reauthenticate(Some(routes.ExternalAuth.change(id).url))).toFuccess
    else
      env.user.repo
        .isManaged(me.userId)
        .flatMap:
          case true => failure
          case false =>
            service
              .takeChange(id, me.userId, session)
              .filter(_.unlink)
              .fold(failure): change =>
                identities
                  .list(me.userId)
                  .flatMap: linked =>
                    linked
                      .find(_.startsWith(s"${change.provider}:"))
                      .fold(failure): key =>
                        identities
                          .unlink(me.userId, key)
                          .flatMap:
                            case true => Redirect(routes.ExternalAuth.index).flashSuccess.toFuccess
                            case false => BadRequest.page(ui.lastMethod)
  }

  private def verification(form: Form[?], returnTo: String, bad: Boolean = false)(using
      ctx: Context,
      me: Me
  ): Fu[Result] =
    for
      linked <- identities.list(me.userId)
      password <- identities.hasPassword(me.userId)
      change = service.getChange(returnTo.stripPrefix("/account/login-methods/change/"), me.userId, session)
      result <- (if bad then BadRequest else Ok).page(
        ui.reauthenticate(
          form,
          service.providers.filter(p => linked.exists(_.startsWith(s"${p.id}:"))),
          linked,
          password,
          returnTo,
          change.flatMap(c => service.provider(c.provider).map(p => p.name -> c.unlink)),
          returnTo == routes.Account.passwd.url
        )
      )
    yield result

  def reauthenticate(returnTo: Option[String]) = Auth { ctx ?=> me ?=>
    verification(passwordForm, safeReturn(returnTo.getOrElse(routes.ExternalAuth.index.url)))
  }

  def reauthenticatePassword = AuthBody { ctx ?=> me ?=>
    auth.HasherRateLimit:
      val returnTo = safeReturn(get("returnTo").getOrElse(routes.ExternalAuth.index.url))
      passwordForm
        .bindFromRequest()
        .fold(
          err => verification(err, returnTo, bad = true),
          (password, token) =>
            env.security.authenticator
              .loginCandidateById(me.userId)
              .flatMap: candidate =>
                candidate
                  .filter(_.user.enabled.yes)
                  .map(
                    _(PasswordAndToken(ClearPassword(password), token.map(lila.user.TotpToken.apply)))
                  ) match
                  case Some(LoginCandidate.Result.Success(_)) =>
                    service.confirm(me.userId)
                    Redirect(returnTo).toFuccess
                  case result =>
                    val error = result match
                      case Some(
                            LoginCandidate.Result.MissingTotpToken | LoginCandidate.Result.InvalidTotpToken
                          ) =>
                        passwordForm.withError("token", "invalidAuthenticationCode")
                      case _ => passwordForm.withError("password", "incorrectPassword")
                    verification(error, returnTo, bad = true)
        )
  }

  def reauthenticateProvider(provider: String, returnTo: Option[String]) = AuthBody { ctx ?=> me ?=>
    attempts(ctx.ip, rateLimited):
      identities
        .list(me.userId)
        .flatMap: linked =>
          if !linked.exists(_.startsWith(s"$provider:")) then failure
          else
            begin(
              provider,
              Purpose.Confirm(me.userId, session),
              safeReturn(returnTo.getOrElse(routes.ExternalAuth.index.url))
            )
  }

  private val linkCookieName = "external_link"

  def startExisting = OpenBody:
    attempts(ctx.ip, rateLimited):
      if ctx.isAuth then failure
      else
        (for
          binding <- browser
          _ <- service.getPending(binding).filter(_.purpose == Purpose.Login)
        yield Redirect(
          s"${routes.Auth.login.url}?method=password&referrer=${routes.ExternalAuth.linkExisting.url}"
        )
          .withCookies(
            env.security.lilaCookie.cookie(linkCookieName, binding, maxAge = Some(600), httpOnly = Some(true))
          )
          .toFuccess).getOrElse(failure)

  private def existingPending(using ctx: Context): Option[(String, Pending)] =
    for
      binding <- ctx.req.cookies.get(linkCookieName).map(_.value)
      pending <- service.getPending(binding).filter(_.purpose == Purpose.Login)
    yield binding -> pending

  def linkExisting = Auth { ctx ?=> me ?=>
    existingPending.fold(failure): (_, pending) =>
      service
        .provider(pending.identity.provider)
        .fold(failure): provider =>
          Ok.page(ui.linkExisting(provider.name, me.username.value, service.confirmed(me.userId)))
  }

  def linkExistingPost = AuthBody { ctx ?=> me ?=>
    if !service.confirmed(me.userId) then failure
    else
      existingPending.fold(failure): (binding, pending) =>
        env.user.repo
          .isManaged(me.userId)
          .flatMap:
            case true => failure
            case false =>
              if !service.takePending(binding).contains(pending) then failure
              else
                identities
                  .link(me.userId, pending.identity.key)
                  .flatMap:
                    case true =>
                      Redirect(pending.returnTo)
                        .discardingCookies(
                          env.security.lilaCookie.discard(linkCookieName),
                          env.security.lilaCookie.discard(cookieName)
                        )
                        .toFuccess
                    case false => failure
  }

  def cancel = OpenBody:
    browser.foreach(service.clear)
    ctx.req.cookies.get(linkCookieName).foreach(c => service.clear(c.value))
    Redirect(routes.Auth.login)
      .discardingCookies(
        env.security.lilaCookie.discard(cookieName),
        env.security.lilaCookie.discard(linkCookieName)
      )
      .toFuccess
