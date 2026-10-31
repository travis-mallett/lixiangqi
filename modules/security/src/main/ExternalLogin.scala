package lila.security

import java.net.URLEncoder
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{ Files, Path }
import java.security.MessageDigest
import java.util.Base64
import play.api.Configuration
import play.api.libs.json.*
import play.api.libs.ws.StandaloneWSClient
import play.api.libs.ws.DefaultBodyWritables.*
import play.api.mvc.RequestHeader
import scalalib.SecureRandom

import lila.core.config.NetConfig
import lila.memo.CacheApi

/** OAuth is used only to establish identity. Provider tokens never enter browser cookies or storage. */
final class ExternalLogin(config: Configuration, net: NetConfig, ws: StandaloneWSClient, cache: CacheApi)(
    using Executor
):
  import ExternalLogin.*

  private val googleFile = config.get[String]("security.external.google.credentials_file")
  private lazy val googleCredentials: Option[(String, String)] =
    Option.when(googleFile.nonEmpty && Files.isRegularFile(Path.of(googleFile))):
      val web = Json.parse(Files.readString(Path.of(googleFile))) \ "web"
      ((web \ "client_id").as[String], (web \ "client_secret").as[String])

  private lazy val zaloCredentials: Option[(String, String)] =
    if !config.getOptional[Boolean]("security.external.zalo.enabled").contains(true) then None
    else loadZaloCredentials

  private def loadZaloCredentials: Option[(String, String)] =
    config
      .getOptional[String]("security.external.zalo.credentials_file")
      .filter(file => file.nonEmpty && Files.isRegularFile(Path.of(file)))
      .map: file =>
        try
          val data = Json.parse(Files.readString(Path.of(file)))
          val id = (data \ "app_id").as[String]
          val secret = (data \ "secret_key").as[String]
          require(id.nonEmpty && id.forall(_.isDigit) && secret.nonEmpty)
          id -> secret
        catch
          case scala.util.control.NonFatal(_) =>
            throw new IllegalArgumentException("Invalid Zalo OAuth credential file")

  lazy val providers: List[Provider] = List(
    Option.when(config.get[Boolean]("security.external.lichess.enabled"))(
      Provider(
        "lichess",
        "Lichess",
        "https://lichess.org/oauth",
        "https://lichess.org/api/token",
        "https://lichess.org/api/account",
        net.domain.value,
        None,
        ""
      )
    ),
    Option.when(config.get[Boolean]("security.external.lishogi.enabled"))(
      Provider(
        "lishogi",
        "Lishogi",
        "https://lishogi.org/oauth",
        "https://lishogi.org/api/token",
        "https://lishogi.org/api/account",
        net.domain.value,
        None,
        ""
      )
    ),
    googleCredentials.map((id, secret) =>
      Provider(
        "google",
        "Google",
        "https://accounts.google.com/o/oauth2/v2/auth",
        "https://oauth2.googleapis.com/token",
        "https://openidconnect.googleapis.com/v1/userinfo",
        id,
        Some(secret),
        "openid email"
      )
    ),
    zaloCredentials.map((id, secret) =>
      Provider(
        "zalo",
        "Zalo",
        "https://oauth.zaloapp.com/v4/permission",
        "https://oauth.zaloapp.com/v4/access_token",
        "https://graph.zalo.me/v2.0/me",
        id,
        Some(secret),
        ""
      )
    )
  ).flatten.sortBy(p => List("google", "zalo", "lichess", "lishogi").indexOf(p.id))

  def provider(id: String): Option[Provider] = providers.find(_.id == id)

  def googleClientId: Option[String] = googleCredentials.map(_._1)

  // Bounded, short-lived, single-use server-side state; restarting safely cancels unfinished logins.
  private val attempts = cache.notLoadingSync[String, Attempt](4096, "externalLogin.attempts"):
    _.maximumSize(4096).expireAfterWrite(10.minutes).build()
  private val pending = cache.notLoadingSync[String, Pending](4096, "externalLogin.pending"):
    _.maximumSize(4096).expireAfterWrite(10.minutes).build()
  private val confirmations =
    cache.notLoadingSync[(String, UserId), Boolean](4096, "externalLogin.confirmed"):
      _.maximumSize(4096).expireAfterWrite(5.minutes).build()

  private val changes = cache.notLoadingSync[String, Change](4096, "externalLogin.changes"):
    _.maximumSize(4096).expireAfterWrite(10.minutes).build()

  def saveChange(user: UserId, session: String, provider: String, unlink: Boolean): String =
    val id = random()
    changes.put(id, Change(user, session, provider, unlink))
    id

  private val native = cache.notLoadingSync[String, NativeAttempt](4096, "externalLogin.native"):
    _.maximumSize(4096).expireAfterWrite(10.minutes).build()

  def nativeBegin(user: UserId, binding: String, provider: String, link: Boolean): String =
    val id = random()
    native.put(id, NativeAttempt(user, binding, provider, link))
    id

  def nativeLaunch(id: String): Option[NativeAttempt] = native
    .getIfPresent(id)
    .filterNot(_.launched)
    .filter: a =>
      native.underlying.asMap().replace(id, a, a.copy(launched = true))

  def nativeExists(id: String): Boolean = native.getIfPresent(id).exists(_.launched)

  def nativeComplete(id: String, identity: Identity): Boolean = native
    .getIfPresent(id)
    .exists: a =>
      a.launched && a.identity.isEmpty && a.provider == identity.provider &&
        native.underlying.asMap().replace(id, a, a.copy(identity = Some(identity)))

  def nativeGet(id: String, user: UserId, binding: String): Option[NativeAttempt] =
    native.getIfPresent(id).filter(a => a.user == user && a.binding == binding)

  def nativeTake(id: String, attempt: NativeAttempt): Boolean = native.underlying.asMap().remove(id, attempt)

  def getChange(id: String, user: UserId, session: String): Option[Change] =
    changes.getIfPresent(id).filter(c => c.user == user && c.session == session)

  def takeChange(id: String, user: UserId, session: String): Option[Change] =
    getChange(id, user, session).flatMap: expected =>
      Option.when(changes.underlying.asMap().remove(id, expected))(expected)

  def callbackUrl(p: Provider) = s"${net.baseUrl.value}/auth/external/${p.id}/callback"

  def begin(p: Provider, browser: String, purpose: Purpose, returnTo: String): String =
    val state = random()
    val verifier = random()
    attempts.put(state, Attempt(p.id, browser, verifier, purpose, safeReturn(returnTo)))
    val params = List(
      p.clientIdParameter -> p.clientId,
      "redirect_uri" -> callbackUrl(p),
      "state" -> state,
      "code_challenge" -> challenge(verifier)
    ) ++ (if p.isZalo then Nil
          else
            List(
              "response_type" -> "code",
              "scope" -> p.scope,
              "code_challenge_method" -> "S256"
            ))
    s"${p.authorizeUrl}?${params.map((k, v) => s"$k=${URLEncoder.encode(v, UTF_8)}").mkString("&")}"

  def complete(p: Provider, browser: String, state: String, code: String): Fu[Pending] =
    val attempt = Option(attempts.underlying.asMap().remove(state))
    attempt match
      case None => fufail(Failed(Stage.State, Reason.ExpiredOrConsumed))
      case Some(a) if a.provider != p.id || a.browser != browser =>
        fufail(Failed(Stage.State, Reason.BindingMismatch))
      case Some(a) =>
        val data = Map(
          "grant_type" -> Seq("authorization_code"),
          "code" -> Seq(code),
          p.clientIdParameter -> Seq(p.clientId),
          "code_verifier" -> Seq(a.verifier)
        ) ++ (if p.isZalo then Map.empty[String, Seq[String]]
              else Map("redirect_uri" -> Seq(callbackUrl(p))) ++ p.secret.map(s => "client_secret" -> Seq(s)))
        val tokenRequest = ws
          .url(p.tokenUrl)
          .withRequestTimeout(10.seconds)
          .withFollowRedirects(false)
          .addHttpHeaders((if p.isZalo then p.secret.toList.map("secret_key" -> _) else Nil)*)
        val accountRequest = ws.url(p.accountUrl).withRequestTimeout(10.seconds).withFollowRedirects(false)
        for
          tokenResponse <- tokenRequest
            .post(data)
            .recoverWith:
              case scala.util.control.NonFatal(_) => fufail(Failed(Stage.Token, Reason.Transport))
          tokenData = decodeResponse(p.id, Stage.Token, tokenResponse.status, tokenResponse.body)
          token <- (tokenData \ "access_token")
            .asOpt[String]
            .filter(_.nonEmpty)
            .fold[Fu[String]](fufail(Failed(Stage.Token, Reason.MissingIdentityOrToken)))(fuccess)
          response <- (if p.isZalo then
                         accountRequest
                           .addQueryStringParameters("fields" -> "id")
                           .addHttpHeaders("access_token" -> token)
                       else accountRequest.addHttpHeaders("Authorization" -> s"Bearer $token"))
            .get()
            .recoverWith:
              case scala.util.control.NonFatal(_) => fufail(Failed(Stage.Profile, Reason.Transport))
          profile = decodeResponse(p.id, Stage.Profile, response.status, response.body)
          identity <- readIdentity(p.id, profile).fold[Fu[Identity]](
            fufail(Failed(Stage.Profile, Reason.MissingIdentityOrToken))
          )(fuccess)
        yield Pending(identity, a.purpose, a.returnTo)

  def reportFailure(provider: String, failed: Failed): Unit =
    val name = if Set("google", "zalo", "lichess", "lishogi").contains(provider) then provider else "unknown"
    // Never attach the original exception, response body, URL, cookies, state, or provider messages.
    logger.warn(s"ExternalLogin provider=$name ${failed.getMessage}")

  def savePending(browser: String, value: Pending): Unit = pending.put(browser, value)
  def getPending(browser: String): Option[Pending] = pending.getIfPresent(browser)
  def takePending(browser: String): Option[Pending] = Option(pending.underlying.asMap().remove(browser))
  def clear(browser: String): Unit = pending.invalidate(browser)

  def signupIdentity(using req: RequestHeader): Option[Identity] =
    req.cookies
      .get(cookieName)
      .flatMap(c => getPending(c.value))
      .collect:
        case Pending(identity, Purpose.Login, _) => identity

  def confirm(user: UserId)(using req: RequestHeader): Unit =
    confirmationBinding.foreach(confirmSession(user, _))

  def confirmSession(user: UserId, session: String): Unit = confirmations.put(session -> user, true)

  def confirmed(user: UserId)(using req: RequestHeader): Boolean =
    confirmationBinding.exists(s => confirmations.getIfPresent(s -> user).contains(true))

  // Native confirmation belongs to this bearer, never to the whole account or
  // an unrelated browser session. Only its digest enters the bounded cache.
  def confirmationBinding(using req: RequestHeader): Option[String] =
    req.headers
      .get("Authorization")
      .filter(_.startsWith("Bearer "))
      .map { value =>
        "oauth:" + Base64.getUrlEncoder.withoutPadding.encodeToString(
          MessageDigest.getInstance("SHA-256").digest(value.getBytes(UTF_8))
        )
      }
      .orElse(req.session.get("sessionId"))

object ExternalLogin:
  val cookieName = "external_login"
  enum Stage:
    case Callback, State, Token, Profile, Session
  enum Reason:
    case MissingParameters, ExpiredOrConsumed, BindingMismatch, Transport, Http, InvalidJson,
      ProviderRejected, MissingIdentityOrToken, PurposeMismatch, Unexpected
  case class Failed(
      stage: Stage = Stage.Callback,
      reason: Reason = Reason.Unexpected,
      httpStatus: Option[Int] = None,
      providerError: Option[Int] = None
  ) extends Exception(
        s"stage=$stage reason=$reason http=${httpStatus.fold("none")(_.toString)} providerError=${providerError.fold("none")(_.toString)}"
      )

  private[security] def decodeResponse(provider: String, stage: Stage, status: Int, body: String): JsValue =
    val parsed = scala.util.Try(Json.parse(body)).toOption
    val error = if provider == "zalo" then parsed.flatMap(j => (j \ "error").asOpt[Int]) else None
    if status != 200 then throw Failed(stage, Reason.Http, Some(status), error)
    val data = parsed.getOrElse(throw Failed(stage, Reason.InvalidJson, Some(status)))
    if !successfulResponse(provider, data) then
      throw Failed(stage, Reason.ProviderRejected, Some(status), error)
    data
  case class Provider(
      id: String,
      name: String,
      authorizeUrl: String,
      tokenUrl: String,
      accountUrl: String,
      clientId: String,
      secret: Option[String],
      scope: String
  ):
    def isZalo = id == "zalo"
    // Chess-provider subjects are public handles; Google and Zalo subjects are opaque identifiers.
    def linkedAccountName(linked: List[String]): String =
      if id == "lichess" || id == "lishogi" then
        linked.find(_.startsWith(s"$id:")).fold(name)(key => s"$name (${key.drop(id.length + 1)})")
      else name
    def clientIdParameter = if isZalo then "app_id" else "client_id"
    override def toString = s"ExternalLogin.Provider($id)"
  enum Purpose:
    case Login
    case Native(id: String)
    case Link(user: UserId, session: String)
    case Confirm(user: UserId, session: String)
  case class Identity(provider: String, subject: String, verifiedEmail: Option[EmailAddress] = None):
    def key = s"$provider:$subject"
  case class Change(user: UserId, session: String, provider: String, unlink: Boolean)
  case class NativeAttempt(
      user: UserId,
      binding: String,
      provider: String,
      link: Boolean,
      launched: Boolean = false,
      identity: Option[Identity] = None
  )
  case class Pending(identity: Identity, purpose: Purpose, returnTo: String)
  private case class Attempt(
      provider: String,
      browser: String,
      verifier: String,
      purpose: Purpose,
      returnTo: String
  )

  def random(): String = Base64.getUrlEncoder.withoutPadding.encodeToString(SecureRandom.nextBytes(32))
  def challenge(verifier: String): String =
    Base64.getUrlEncoder.withoutPadding.encodeToString(
      MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(UTF_8))
    )

  def safeReturn(value: String): String =
    if value.startsWith("/") && !value.startsWith("//") && !value.exists(c => c == '\\' || c.isControl)
    then value
    else "/"

  def readIdentity(provider: String, data: JsValue): Option[Identity] =
    val field = if provider == "google" then "sub" else "id"
    val closed = (data \ "closed").asOpt[Boolean].contains(true)
    Option
      .when(!closed && successfulResponse(provider, data))((data \ field).asOpt[String])
      .flatten
      .filter(s => s.nonEmpty && s.length <= 255 && !s.exists(_.isControl))
      .map(subject => Identity(provider, subject, verifiedGoogleEmail(provider, data)))

  // Zalo can return an API error with HTTP 200. Missing error is valid for token responses.
  private def successfulResponse(provider: String, data: JsValue): Boolean =
    provider != "zalo" || (data \ "error").toOption.forall(_ == JsNumber(0))

  // Google is authoritative for Gmail and verified Workspace addresses, not arbitrary third-party mail.
  private def verifiedGoogleEmail(provider: String, data: JsValue): Option[EmailAddress] =
    for
      _ <- Option.when(provider == "google" && (data \ "email_verified").asOpt[Boolean].contains(true))(())
      email <- (data \ "email").asOpt[String].flatMap(EmailAddress.from)
      if email.value.toLowerCase.endsWith("@gmail.com") || (data \ "hd").asOpt[String].exists(_.nonEmpty)
    yield email
