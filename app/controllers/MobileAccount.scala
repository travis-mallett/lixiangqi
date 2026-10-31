package controllers

import play.api.data.Form
import play.api.data.Forms.*
import play.api.libs.json.*
import play.api.mvc.*

import lila.app.*
import lila.common.Json.given
import lila.core.security.ClearPassword
import lila.core.user.KidMode
import lila.security.{ LoginCandidate, PasswordAndToken }
import lila.user.TotpSecret.base32

/** Native account controls reuse the website's validation, management rules, email delivery, identity linking
  * and termination services. No browser session is created from an access token.
  */
final class MobileAccount(env: Env, auth: => Auth) extends LilaController(env):
  private def identity = env.security.externalLogin
  private def identities = env.security.externalIdentities
  private def error(status: Int, code: String) = Status(status)(Json.obj("error" -> code))
  private def done = JsonOk(Json.obj("ok" -> true)).toFuccess
  private def noStore(result: Fu[Result]) = result.map(_.withHeaders(CACHE_CONTROL -> "no-store"))
  private def invalid(form: Form[?]) = BadRequest(
    Json.obj("error" -> "validation_error", "fields" -> form.errors.groupMap(_.key)(_.message))
  ).toFuccess
  private def confirmed(run: => Fu[Result])(using Context, Me): Fu[Result] =
    if identity.confirmed(summon[Me].userId) then noStore(run)
    else error(403, "confirmation_required").toFuccess
  private def unmanaged(run: => Fu[Result])(using Me): Fu[Result] =
    env.user.repo
      .isManaged(summon[Me].userId)
      .flatMap:
        case true => error(403, "managed_account").toFuccess
        case false => run

  def state = Scoped(_.Mobile.Account) { ctx ?=> me ?=>
    noStore:
      for
        linked <- identities.list(me.userId)
        password <- identities.hasPassword(me.userId)
        managed <- env.user.repo.isManaged(me.userId)
        email <- env.user.repo.email(me)
      yield JsonOk(
        Json.obj(
          "username" -> me.username,
          "email" -> email.map(_.value),
          "password" -> password,
          "twoFactor" -> me.totpSecret.isDefined,
          "kid" -> me.kid.yes,
          "managed" -> managed,
          "confirmed" -> identity.confirmed(me.userId),
          "providers" -> identity.providers.map(p =>
            Json.obj(
              "id" -> p.id,
              "name" -> p.linkedAccountName(linked),
              "linked" -> linked.exists(_.startsWith(s"${p.id}:")),
              "canUnlink" -> (password || linked.size > 1)
            )
          )
        )
      )
  }

  def confirm = ScopedBody(_.Mobile.Account) { ctx ?=> me ?=>
    noStore:
      auth.HasherRateLimit:
        bindForm(
          Form(tuple("password" -> nonEmptyText(maxLength = 999), "token" -> optional(text(maxLength = 8))))
        )(
          invalid,
          (password, token) =>
            env.security.authenticator
              .loginCandidateById(me.userId)
              .map: candidate =>
                candidate.map(
                  _(PasswordAndToken(ClearPassword(password), token.map(lila.user.TotpToken.apply)))
                ) match
                  case Some(LoginCandidate.Result.Success(_)) =>
                    identity.confirm(me.userId)
                    JsonOk(Json.obj("ok" -> true))
                  case Some(
                        LoginCandidate.Result.MissingTotpToken | LoginCandidate.Result.InvalidTotpToken
                      ) =>
                    error(400, "invalid_totp")
                  case _ => error(400, "invalid_credentials")
        )
  }

  def providerStart(provider: String) = ScopedBody(_.Mobile.Account) { ctx ?=> me ?=>
    noStore:
      val link = getBool("link")
      if identity.provider(provider).isEmpty then error(404, "provider_unavailable").toFuccess
      else if link && !identity.confirmed(me.userId) then error(403, "confirmation_required").toFuccess
      else
        unmanaged:
          identities
            .list(me.userId)
            .flatMap: linked =>
              if !link && !linked.exists(_.startsWith(s"$provider:")) then
                error(400, "provider_not_linked").toFuccess
              else
                val id = identity.nativeBegin(me.userId, identity.confirmationBinding.get, provider, link)
                JsonOk(
                  Json.obj("id" -> id, "url" -> s"${env.net.baseUrl.value}/auth/external/mobile/$id")
                ).toFuccess
  }

  def providerFinish(id: String) = ScopedBody(_.Mobile.Account) { ctx ?=> me ?=>
    noStore:
      auth.HasherRateLimit:
        bindForm(Form(single("token" -> optional(text(maxLength = 8)))))(
          invalid,
          token =>
            identity.nativeGet(id, me.userId, identity.confirmationBinding.get) match
              case None => error(400, "verification_expired").toFuccess
              case Some(a) if a.identity.isEmpty => error(409, "verification_pending").toFuccess
              case Some(a) =>
                val external = a.identity.get
                env.security.api
                  .checkExternalLogin(me.value, token)
                  .flatMap:
                    case LoginCandidate.Result.Success(_) =>
                      if a.link then
                        confirmed:
                          unmanaged:
                            if !identity.nativeTake(id, a) then error(400, "verification_expired").toFuccess
                            else
                              identities
                                .link(me.userId, external.key)
                                .map:
                                  case true => JsonOk(Json.obj("ok" -> true))
                                  case false => error(409, "provider_already_linked")
                      else
                        identities
                          .owner(external.key)
                          .map:
                            case Some(owner) if owner.id == me.userId && identity.nativeTake(id, a) =>
                              identity.confirm(me.userId)
                              JsonOk(Json.obj("ok" -> true))
                            case _ => error(400, "provider_mismatch")
                    case _ => error(400, "invalid_totp").toFuccess
        )
  }

  def unlink(provider: String) = ScopedBody(_.Mobile.Account) { ctx ?=> me ?=>
    confirmed:
      unmanaged:
        identities
          .list(me.userId)
          .flatMap: linked =>
            linked
              .find(_.startsWith(s"$provider:"))
              .fold(error(404, "provider_not_linked").toFuccess): key =>
                identities
                  .unlink(me.userId, key)
                  .map:
                    case true => JsonOk(Json.obj("ok" -> true))
                    case false => error(400, "last_login_method")
  }

  def twoFactorSecret = Scoped(_.Mobile.Account) { ctx ?=> me ?=>
    confirmed:
      if me.totpSecret.isDefined then error(409, "already_enabled").toFuccess
      else JsonOk(Json.obj("secret" -> lila.user.TotpSecret.random.base32)).toFuccess
  }

  private def endSessions(using Me): Funit = for
    _ <- env.security.store.closeAllSessionsOf(summon[Me])
    _ <- env.push.browserSub.unsubscribeByUser(summon[Me])
    _ <- env.push.unregisterDevices(summon[Me])
  yield ()

  def change(kind: String) = ScopedBody(_.Mobile.Account) { ctx ?=> me ?=>
    confirmed:
      auth.HasherRateLimit:
        kind match
          case "username" =>
            bindForm(env.user.forms.username(me))(
              invalid,
              name => env.user.repo.setUsernameCased(me, name).flatMap(_ => done)
            )
          case "password" =>
            unmanaged:
              bindForm(env.security.forms.passwdResetForMe)(
                invalid,
                data =>
                  for
                    _ <- env.security.authenticator.setPassword(me, ClearPassword(data.newPasswd1))
                    _ <- env.mod.logApi.setPassword
                    _ <- endSessions
                  yield JsonOk(Json.obj("ok" -> true))
              )
          case "email" =>
            unmanaged:
              for
                _ <- env.security.forms.preloadEmailDns()
                previous <- env.user.repo.email(me)
                form <- env.security.forms.changeEmail(previous)
                result <- bindForm(form)(
                  invalid,
                  data =>
                    auth.EmailConfirmRateLimit(
                      lila.security.EmailConfirm.UserEmail(me.username, data.email),
                      ctx.req,
                      rateLimited
                    ):
                      env.security.emailChange
                        .send(me, data.email)
                        .map(_ => JsonOk(Json.obj("ok" -> true, "checkEmail" -> true)))
                )
              yield result
          case "twofactor-enable" =>
            env.security.forms.setupTwoFactor.flatMap: form =>
              bindForm(form)(
                invalid,
                data =>
                  for
                    _ <- env.user.repo.setupTwoFactor(me, lila.user.TotpSecret.decode(data.secret))
                    _ <- endSessions
                  yield JsonOk(Json.obj("ok" -> true))
              )
          case "twofactor-disable" =>
            env.security.forms.disableTwoFactor.flatMap(form =>
              bindForm(form)(invalid, _ => env.user.repo.disableTwoFactor(me).flatMap(_ => done))
            )
          case "kid" =>
            unmanaged:
              bindForm(Form(single("enabled" -> play.api.data.Forms.boolean)))(
                invalid,
                enabled => env.user.api.setKid(me, KidMode(enabled)).flatMap(_ => done)
              )
          case "close" =>
            unmanaged:
              env.security.forms.closeAccount.flatMap(form =>
                bindForm(form)(
                  invalid,
                  forever =>
                    env.api.accountTermination.disable(me.value, forever = forever).flatMap(_ => done)
                )
              )
          case "delete" =>
            unmanaged:
              env.security.forms.deleteAccount.flatMap(form =>
                bindForm(form)(
                  invalid,
                  _ => env.api.accountTermination.scheduleDelete(me.value).flatMap(_ => done)
                )
              )
          case _ => error(404, "unknown_action").toFuccess
  }

  def sessions = Scoped(_.Mobile.Account) { ctx ?=> me ?=>
    confirmed:
      for
        sessions <- env.security.api.locatedOpenSessions(me, 50)
        clients <- env.oAuth.tokenApi.listClients(50)
        tokens <- env.oAuth.tokenApi.listPersonal
      yield JsonOk(
        Json.obj(
          "sessions" -> sessions.map(s =>
            Json.obj(
              "id" -> s.session.id.value,
              "ip" -> s.session.ip.value,
              "location" -> s.location.map(_.toString),
              "agent" -> s.session.ua.toString
            )
          ),
          "clients" -> clients.map(c =>
            Json.obj("origin" -> c.origin.value, "scopes" -> c.scopes.map(_.name.txt()))
          ),
          "tokens" -> tokens.map(t => Json.obj("id" -> t.id.value, "description" -> t.description)),
          "scopes" -> lila.oauth.OAuthScope.classified
            .flatMap(_._2)
            .filterNot(_ == lila.oauth.OAuthScope.Web.Mod)
            .distinct
            .map(s => Json.obj("key" -> s.key, "name" -> s.name.txt()))
        )
      )
  }

  def revoke(kind: String) = ScopedBody(_.Mobile.Account) { ctx ?=> me ?=>
    confirmed:
      bindForm(Form(single("id" -> nonEmptyText(maxLength = 512))))(
        invalid,
        id =>
          (kind match
            case "session" if id == "all" => endSessions
            case "session" =>
              val session = lila.core.id.SessionId(id)
              env.security.store.closeUserAndSessionId(me, session) >> env.push.browserSub
                .unsubscribeBySession(session)
            case "client" => env.oAuth.tokenApi.revokeByClientOrigin(lila.core.net.Origin(id))
            case "token" => env.oAuth.tokenApi.revokeById(lila.core.misc.oauth.AccessTokenId(id))
            case _ => fufail(IllegalArgumentException("Unknown revocation"))
          ).flatMap(_ => done)
      )
  }

  def createToken = ScopedBody(_.Mobile.Account) { ctx ?=> me ?=>
    confirmed:
      bindForm(lila.oauth.OAuthTokenForm.create)(
        invalid,
        data =>
          env.oAuth.tokenApi
            .create(data, env.clas.filters.student(me))
            .map(t => JsonOk(Json.obj("token" -> t.plain.value)))
      )
  }
