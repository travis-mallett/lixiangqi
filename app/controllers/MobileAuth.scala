package controllers

import play.api.data.Form
import play.api.libs.json.*
import play.api.mvc.*

import lila.app.*
import lila.common.HTTPRequest
import lila.common.Json.given
import lila.core.net.ValidReferrer
import lila.security.{ IsPwned, Signup }

/** First-party native forms. Never consumes browser cookies or returns HTML. */
final class MobileAuth(env: Env, auth: => Auth) extends LilaController(env):
  private val requestLimit = lila.memo.RateLimit[lila.core.net.IpAddress](
    30,
    5.minutes,
    "mobile.auth.requests"
  )(using lila.core.config.RateLimit.Yes)(using env.executor)
  private given Option[ValidReferrer] = None
  private def codes = env.security.mobileEmailCode
  private def error(status: Int, code: String) = Status(status)(Json.obj("error" -> code))
  private def invalid(form: Form[?]) = BadRequest(
    Json.obj(
      "error" -> "validation_error",
      "fields" -> form.errors.groupMap(_.key)(_.message)
    )
  )

  private def allowed(run: => Fu[Result])(using Context): Fu[Result] =
    val result = if !env.security.firewall.accepts(req) then fuccess(error(403, "forbidden_network"))
    else requestLimit(HTTPRequest.ipAddress(req), fuccess(error(429, "rate_limited")))(run)
    result.map(_.withHeaders(CACHE_CONTROL -> "no-store"))

  def login = AnonBodyOf(parse.formUrlEncoded(16384)): data =>
    allowed:
      env.security.api.loginForm
        .bindFromRequest()
        .fold(
          form => fuccess(invalid(form)),
          credentials =>
            auth.LoginRateLimit(credentials.username.normalize, req): charge =>
              env.security.pwned
                .isPwned(credentials.password)
                .flatMap: pwned =>
                  if pwned.yes then charge()
                  env.security.api
                    .loadLoginForm(credentials.username, pwned)
                    .flatMap: loaded =>
                      loaded
                        .bindFromRequest()
                        .fold(
                          form =>
                            charge()
                            val code = lila.security.LoginCandidate.totpError(form) match
                              case Some("MissingTotpToken") => "missing_totp"
                              case Some("InvalidTotpToken") => "invalid_totp"
                              case _ if form.errors.exists(_.message == "blankedPassword") =>
                                "password_reset_required"
                              case _
                                  if form.errors.exists(_.message.startsWith("This password is too easy")) =>
                                "password_reset_required"
                              case _ if form.errors.exists(_.message.startsWith("2-Factor Authentication")) =>
                                "two_factor_required"
                              case _ => "invalid_credentials"
                            fuccess(error(401, code))
                          ,
                          result =>
                            result.toOption match
                              case None => fuccess(error(401, "invalid_credentials"))
                              case Some(user) if user.enabled.no => fuccess(error(403, "account_closed"))
                              case Some(user) =>
                                env.user.repo
                                  .mustConfirmEmail(user.id)
                                  .flatMap:
                                    if _ then
                                      env.user.repo
                                        .email(user.id)
                                        .flatMap:
                                          case None => fuccess(error(403, "email_unavailable"))
                                          case Some(email) =>
                                            val id = data.get("verificationId").flatMap(_.headOption)
                                            val code =
                                              data.get("emailCode").flatMap(_.headOption).getOrElse("")
                                            id match
                                              case None =>
                                                sendCode(
                                                  email,
                                                  s"confirm:${user.id.value}",
                                                  "email_verification_required"
                                                )
                                              case Some(id)
                                                  if codes
                                                    .consume(id, code, email, s"confirm:${user.id.value}") =>
                                                env.user.repo.setEmailConfirmed(user.id) >> issue(user, pwned)
                                              case _ => fuccess(error(400, "invalid_email_code"))
                                    else issue(user, pwned)
                        )
        )

  def registrationCode = AnonBodyOf(parse.formUrlEncoded(16384)): _ =>
    allowed:
      env.security.ipTrust
        .isPubOrTor(req)
        .flatMap:
          if _ then fuccess(error(403, "forbidden_network"))
          else
            env.security.forms.preloadEmailDns() >>
              env.security.forms.signup.emailCheck
                .bindFromRequest()
                .fold(
                  form => fuccess(invalid(form)),
                  email => sendCode(email, "register", "code_sent")
                )

  private def sendCode(email: EmailAddress, purpose: String, status: String)(using Context): Fu[Result] =
    val service = codes
    service
      .send(email, purpose)
      .map:
        case service.Result.Sent(id) => Ok(Json.obj("status" -> status, "verificationId" -> id))
        case service.Result.Limited => error(429, "rate_limited")
        case service.Result.Unavailable => error(503, "email_unavailable")

  def register = AnonBodyOf(parse.formUrlEncoded(16384)): data =>
    allowed:
      env.security.ipTrust
        .isPubOrTor(req)
        .flatMap:
          if _ then fuccess(error(403, "forbidden_network"))
          else
            WithProxy: _ ?=>
              val id = data.get("verificationId").flatMap(_.headOption).getOrElse("")
              val code = data.get("emailCode").flatMap(_.headOption).getOrElse("")
              env.security.signup
                .mobile(email => codes.consume(id, code, email, "register"))
                .flatMap:
                  case Signup.Result.FormInvalid(form) => fuccess(invalid(form))
                  case Signup.Result.EmailCodeInvalid => fuccess(error(400, "invalid_email_code"))
                  case Signup.Result.RateLimited | Signup.Result.SimpleSignupDuplicate =>
                    fuccess(error(429, "rate_limited"))
                  case Signup.Result.ForbiddenNetwork => fuccess(error(403, "forbidden_network"))
                  case Signup.Result.TurnstileFail | Signup.Result.ConfirmEmail(_, _) =>
                    fuccess(error(500, "registration_failed"))
                  case Signup.Result.AllSet(user, email) =>
                    auth.welcome(user, email, sendWelcomeEmail = true) >> issue(user, IsPwned.No)

  private def issue(user: UserModel, pwned: IsPwned)(using Context): Fu[Result] =
    // Reuse the site's session audit and email-confirmation guard, without cookies.
    for
      session <- env.security.api.saveAuthentication(user.id, None, pwned)
      _ <- env.security.store.delete(session)
      token <- env.oAuth.tokenApi.createMobile(user.id)
    yield Ok(Json.obj("access_token" -> token.plain, "token_type" -> "Bearer"))
