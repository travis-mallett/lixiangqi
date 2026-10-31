package lila.security.ui

import java.net.URLEncoder
import java.nio.charset.StandardCharsets.UTF_8
import play.api.data.Form
import lila.security.ExternalLogin.Provider
import lila.ui.*
import lila.ui.ScalatagsTemplate.{ *, given }

final class ExternalAuthUi(helpers: Helpers)(AccountPage: (String, String) => Context ?=> Page):
  import helpers.{ *, given }

  def linkExisting(provider: String, username: String, confirmed: Boolean)(using Context) =
    Page(trans.site.linkProvider.txt()).css("bits.auth"):
      main(cls := "auth box box-pad")(
        h1(trans.site.linkProvider()),
        p(trans.site.linkProviderToAccount(provider, username)),
        if confirmed then
          postForm(action := routes.ExternalAuth.linkExistingPost)(
            submitButton(cls := "button")(trans.site.linkProvider())
          )
        else
          p(
            a(href := routes.ExternalAuth.reauthenticate(Some(routes.ExternalAuth.linkExisting.url)))(
              trans.site.confirmIdentity()
            )
          )
        ,
        postForm(cls := "auth-footer", action := routes.ExternalAuth.cancel)(
          submitButton(cls := "button button-empty")(trans.site.cancel())
        )
      )

  private val providerUi = lila.ui.ProviderUi(helpers)

  def nativeComplete(using Context) = Page(trans.site.mobileApp.txt()):
    main(cls := "page-small box box-pad")(
      h1(trans.site.mobileApp()),
      p(lila.core.i18n.I18nKey("returnToMobileApp")())
    )

  def verificationFailed(returnTo: String)(using Context) =
    AccountPage(trans.site.confirmIdentity.txt(), "loginMethods"):
      div(cls := "box box-pad identity-check")(
        h1(trans.site.confirmIdentity()),
        p(cls := "identity-check__intro")(trans.site.linkedAccountRequired()),
        a(cls := "button button-no-upper", href := routes.ExternalAuth.reauthenticate(Some(returnTo)))(
          trans.site.verifyAndContinue()
        ),
        p(cls := "identity-check__cancel")(a(href := routes.ExternalAuth.index)(trans.site.cancel()))
      )

  def index(providers: List[Provider], linked: List[String], password: Boolean, managed: Boolean)(using
      Context
  ) =
    AccountPage(trans.site.loginMethods.txt(), "loginMethods"):
      div(cls := "box box-pad signin-methods")(
        h1(trans.site.loginMethods()),
        standardFlash,
        p(cls := "signin-methods__intro")(trans.site.loginMethodsHelp()),
        managed.option(p(trans.site.managedLoginMethods())),
        frag(
          div(cls := "signin-methods__list")(
            div(cls := "signin-method")(
              span(cls := "signin-method__icon", dataIcon := Icon.Keypad, aria.hidden := "true"),
              div(cls := "signin-method__details")(
                h2(trans.site.password()),
                status(password, if password then trans.site.passwordSet() else trans.site.passwordNotSet())
              ),
              a(cls := "signin-method__action", href := routes.Account.passwd)(
                if password then trans.site.changePassword() else trans.site.addPassword()
              )
            ),
            providers
              .sortBy(p => if p.id == "google" then 0 else 1)
              .map: provider =>
                val connected = linked.exists(_.startsWith(s"${provider.id}:"))
                val last = connected && !password && linked.size <= 1
                div(cls := "signin-method")(
                  providerUi.icon(provider.id),
                  div(cls := "signin-method__details")(
                    h2(provider.linkedAccountName(linked)),
                    status(
                      connected,
                      if connected then trans.site.providerLinked() else trans.site.providerNotLinked()
                    ),
                    last.option(p(cls := "signin-method__hint")(trans.site.keepOneLoginMethod()))
                  ),
                  postForm(action := (if connected then routes.ExternalAuth.unlink(provider.id)
                                      else routes.ExternalAuth.link(provider.id)))(
                    submitButton(
                      cls := s"signin-method__action${
                          if connected then " signin-method__action--danger" else ""
                        }",
                      (last || managed).option(disabled := true)
                    )(if connected then trans.site.unlinkProvider() else trans.site.linkProvider())
                  )
                )
          ),
          p(cls := "signin-methods__note")(trans.site.verifyBeforeChanges())
        )
      )

  private def status(connected: Boolean, text: Frag) =
    p(cls := s"signin-method__status${if connected then " signin-method__status--linked" else ""}")(
      connected.option(span(dataIcon := Icon.Checkmark, aria.hidden := "true")),
      text
    )

  def reauthenticate(
      form: Form[?],
      providers: List[Provider],
      linked: List[String],
      password: Boolean,
      returnTo: String,
      change: Option[(String, Boolean)],
      passwordChange: Boolean
  )(using ctx: Context) =
    AccountPage(trans.site.confirmIdentity.txt(), "loginMethods"):
      div(cls := "box box-pad identity-check")(
        h1(trans.site.confirmIdentity()),
        p(cls := "identity-check__intro")(
          change.fold[Frag](
            if passwordChange then trans.site.verifyPasswordChange() else trans.site.confirmIdentityHelp()
          ) { (provider, unlink) =>
            if unlink then trans.site.verifyUnlink(provider) else trans.site.verifyLink(provider)
          }
        ),
        providers.nonEmpty.option(
          providerUi.buttons(
            providers.map(p => p.id -> p.linkedAccountName(linked)),
            id => routes.ExternalAuth.reauthenticateProvider(id, Some(returnTo)).url
          )
        ),
        (password && providers.nonEmpty)
          .option(div(cls := "identity-check__divider")(trans.site.orSeparator())),
        password.option(
          postForm(
            cls := "form3",
            action := s"${routes.ExternalAuth.reauthenticatePassword.url}?returnTo=${URLEncoder.encode(returnTo, UTF_8)}"
          )(
            form3.passwordModified(form("password"), trans.site.password())(
              autocomplete := "current-password"
            ),
            ctx.me
              .exists(_.totpSecret.isDefined)
              .option(
                form3.group(form("token"), trans.tfa.authenticationCode())(form3.totpTokenInput)
              ),
            form3.globalError(form),
            form3.action(form3.submit(trans.site.verifyAndContinue()))
          )
        ),
        p(cls := "identity-check__cancel")(a(href := routes.ExternalAuth.index)(trans.site.cancel()))
      )

  def confirmUnlink(id: String, provider: String, password: Boolean, remaining: List[String])(using Context) =
    AccountPage(trans.site.unlinkProvider.txt(), "loginMethods"):
      div(cls := "box box-pad identity-check")(
        h1(trans.site.unlinkNamedProvider(provider)),
        p(trans.site.unlinkProviderHelp(provider)),
        p(trans.site.remainingLoginMethods()),
        ul(cls := "identity-check__remaining")(
          password.option(li(trans.site.password())),
          remaining.map(name => li(name))
        ),
        postForm(action := routes.ExternalAuth.changeApply(id))(
          submitButton(cls := "button button-red button-no-upper")(trans.site.unlinkProvider())
        ),
        p(cls := "identity-check__cancel")(a(href := routes.ExternalAuth.index)(trans.site.cancel()))
      )

  def twoFactor(form: Form[?])(using Context) =
    Page(trans.tfa.twoFactorAuth.txt()).css("bits.auth"):
      main(cls := "page-small box box-pad")(
        h1(trans.tfa.twoFactorAuth()),
        postForm(cls := "form3", action := routes.ExternalAuth.finishPost)(
          form3.globalError(form),
          form3.group(form("token"), trans.tfa.authenticationCode())(form3.totpTokenInput),
          form3.action(form3.submit(trans.site.signIn()))
        )
      )

  def error(using Context) = Page(trans.site.signIn.txt()):
    main(cls := "page-small box box-pad")(
      h1(trans.site.externalLoginFailed()),
      p(trans.site.externalLoginFailedHelp()),
      p(a(href := routes.Auth.login)(trans.site.signIn())),
      p(a(href := routes.Account.reopen)(trans.site.reopenYourAccount())),
      p(a(href := routes.ExternalAuth.index)(trans.site.loginMethods()))
    )

  def lastMethod(using Context) = AccountPage(trans.site.loginMethods.txt(), "loginMethods"):
    div(cls := "box box-pad")(
      h1(trans.site.loginMethods()),
      p(trans.site.keepOneLoginMethod()),
      a(href := routes.ExternalAuth.index)(trans.site.loginMethods())
    )
