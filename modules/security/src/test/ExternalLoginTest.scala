package lila.security

import java.net.{ InetSocketAddress, URI, URLDecoder }
import java.nio.charset.StandardCharsets.UTF_8
import java.util.concurrent.ConcurrentLinkedQueue
import com.sun.net.httpserver.HttpServer
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.Materializer
import play.api.Configuration
import play.api.libs.json.Json
import play.api.libs.ws.ahc.StandaloneAhcWSClient
import scala.concurrent.Await
import scala.jdk.CollectionConverters.*
import lila.core.config.*

class ExternalLoginTest extends munit.FunSuite:
  import ExternalLogin.*

  test("linked account labels identify chess handles without exposing opaque provider subjects"):
    def provider(id: String, name: String) = Provider(id, name, "", "", "", "", None, "")
    val linked = List("lichess:dweeberkitty", "lishogi:player", "google:private-subject", "zalo:private-id")
    assertEquals(provider("lichess", "Lichess").linkedAccountName(linked), "Lichess (dweeberkitty)")
    assertEquals(provider("lishogi", "Lishogi").linkedAccountName(linked), "Lishogi (player)")
    assertEquals(provider("lichess", "Lichess").linkedAccountName(Nil), "Lichess")
    assertEquals(provider("google", "Google").linkedAccountName(linked), "Google")
    assertEquals(provider("zalo", "Zalo").linkedAccountName(linked), "Zalo")
    assertEquals(
      provider("lichess", "Lichess").linkedAccountName(List("lichess:chinesechessoutloud")),
      "Lichess (chinesechessoutloud)"
    )

  test("provider diagnostics retain only stage, status, and numeric error codes"):
    val secret = "private-token-must-not-appear"
    val rejected = intercept[Failed]:
      decodeResponse(
        "zalo",
        Stage.Profile,
        200,
        Json.obj("error" -> -201, "message" -> secret, "access_token" -> secret).toString
      )
    assertEquals(rejected.stage, Stage.Profile)
    assertEquals(rejected.reason, Reason.ProviderRejected)
    assertEquals(rejected.providerError, Some(-201))
    assert(!rejected.toString.contains(secret))
    assertEquals(rejected.getCause, null)
    val malformed = intercept[Failed](decodeResponse("zalo", Stage.Token, 200, secret))
    assertEquals(malformed.reason, Reason.InvalidJson)
    assert(!malformed.toString.contains(secret))
    val http = intercept[Failed](decodeResponse("zalo", Stage.Token, 503, secret))
    assertEquals(http.httpStatus, Some(503))
    assertEquals(http.reason, Reason.Http)
    val stringError =
      intercept[Failed](decodeResponse("zalo", Stage.Token, 200, Json.obj("error" -> secret).toString))
    assertEquals(stringError.providerError, None)
    assert(!stringError.toString.contains(secret))
    assertEquals(
      decodeResponse("zalo", Stage.Token, 200, """{"access_token":"test"}"""),
      Json.obj("access_token" -> "test")
    )

  test("PKCE matches RFC 7636 S256 test vector"):
    assertEquals(
      challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    )

  test("redirects stay on this site"):
    List("https://evil.test", "//evil.test", "/\\evil.test", "/\r\nevil", "javascript:alert(1)")
      .foreach(url => assertEquals(safeReturn(url), "/"))
    assertEquals(safeReturn("/account/email?x=1"), "/account/email?x=1")

  test("stable provider identity never falls back to a username or email"):
    assertEquals(readIdentity("google", Json.obj("email" -> "a@example.org", "id" -> "wrong")), None)
    val a = readIdentity("google", Json.obj("sub" -> "123", "email" -> "old@example.org"))
    val b = readIdentity("google", Json.obj("sub" -> "123", "email" -> "new@example.org"))
    assertEquals(a, b)
    assertNotEquals(a.get.key, readIdentity("lichess", Json.obj("id" -> "123")).get.key)
    assertEquals(readIdentity("lichess", Json.obj("id" -> "closed", "closed" -> true)), None)
    assertEquals(readIdentity("lishogi", Json.obj("id" -> "")), None)
    assertEquals(readIdentity("zalo", Json.obj("error" -> 0, "id" -> "123")).map(_.key), Some("zalo:123"))
    assertEquals(readIdentity("zalo", Json.obj("error" -> -1, "id" -> "123")), None)
    assertEquals(readIdentity("zalo", Json.obj("error" -> "0", "id" -> "123")), None)
    assertEquals(readIdentity("zalo", Json.obj("name" -> "Someone")), None)

  test("only authoritative verified Google email can replace recovery email confirmation"):
    def identity(
        email: String,
        verified: Boolean = true,
        hosted: Option[String] = None,
        provider: String = "google"
    ) =
      readIdentity(
        provider,
        Json.obj("sub" -> "123", "id" -> "123", "email" -> email, "email_verified" -> verified) ++ hosted
          .fold(Json.obj())(h => Json.obj("hd" -> h))
      ).get
    assertEquals(identity("member@gmail.com").verifiedEmail, Some(EmailAddress("member@gmail.com")))
    assertEquals(identity("member@gmail.com", verified = false).verifiedEmail, None)
    assertEquals(identity("member@example.org").verifiedEmail, None)
    assertEquals(
      identity("member@example.org", hosted = Some("example.org")).verifiedEmail,
      Some(EmailAddress("member@example.org"))
    )
    assertEquals(identity("invalid", hosted = Some("example.org")).verifiedEmail, None)
    assertEquals(identity("member@gmail.com", provider = "lichess").verifiedEmail, None)
    assertEquals(identity("member@gmail.com").key, identity("changed@gmail.com").key)

  test("authorization is browser-bound, provider-bound, single-use, and keeps secrets server-side"):
    val received = new ConcurrentLinkedQueue[Map[String, String]]()
    val zaloRequests = new ConcurrentLinkedQueue[Map[String, String]]()
    @volatile var zaloError = false
    def query(raw: String): Map[String, String] = raw
      .split("&")
      .map: pair =>
        val parts = pair.split("=", 2)
        parts(0) -> URLDecoder.decode(parts.lift(1).getOrElse(""), UTF_8)
      .toMap
    val server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/",
      exchange =>
        val path = exchange.getRequestURI.getPath
        val isZalo = path.startsWith("/zalo/")
        val isToken = path.endsWith("/token")
        val body = new String(exchange.getRequestBody.readAllBytes(), UTF_8)
        if isZalo then
          zaloRequests.add(query(if isToken then body
          else Option(exchange.getRequestURI.getRawQuery).getOrElse("")))
        else if isToken then received.add(query(body))
        val authenticated =
          if isZalo then
            if isToken then exchange.getRequestHeaders.getFirst("secret_key") == "test-secret"
            else exchange.getRequestHeaders.getFirst("access_token") == "test-token"
          else isToken || exchange.getRequestHeaders.getFirst("Authorization") == "Bearer test-token"
        val json =
          if isZalo && zaloError then """{"error":-14014,"access_token":"must-not-be-used","id":"invalid"}"""
          else if isToken then """{"access_token":"test-token"}"""
          else """{"error":0,"id":"stable-user"}"""
        val bytes = json.getBytes(UTF_8)
        exchange.getResponseHeaders.set("Content-Type", "application/json")
        exchange.sendResponseHeaders(if authenticated then 200 else 401, bytes.length)
        exchange.getResponseBody.write(bytes)
        exchange.close()
    )
    server.start()
    given system: ActorSystem = ActorSystem("external-login-test")
    given Executor = system.dispatcher
    given Scheduler = system.scheduler
    given Materializer = Materializer(system)
    given play.api.Mode = play.api.Mode.Test
    val ws = StandaloneAhcWSClient()
    try
      val net = NetConfig(
        NetDomain("local.test"),
        NetDomain("local.test"),
        BaseUrl("https://local.test"),
        AssetDomain("local.test"),
        AssetBaseUrl("https://local.test"),
        false,
        "Test",
        Nil,
        Nil,
        false,
        RateLimit.No,
        EmailAddress("test@example.org"),
        false
      )
      val service = ExternalLogin(
        Configuration("security.external.google.credentials_file" -> ""),
        net,
        ws,
        new lila.memo.CacheApi
      )
      val credentials = java.nio.file.Files.createTempFile("zalo-oauth-test", ".json")
      val nativeOwner = UserId("native-owner")
      val nativeId = service.nativeBegin(nativeOwner, "token-a", "lichess", link = false)
      assertEquals(service.nativeGet(nativeId, nativeOwner, "token-b"), None)
      assertEquals(service.nativeGet(nativeId, UserId("other"), "token-a"), None)
      assert(!service.nativeComplete(nativeId, Identity("lichess", "player")))
      assert(service.nativeLaunch(nativeId).isDefined)
      assertEquals(service.nativeLaunch(nativeId), None)
      assert(!service.nativeComplete(nativeId, Identity("google", "wrong-provider")))
      assert(service.nativeComplete(nativeId, Identity("lichess", "player")))
      assert(!service.nativeComplete(nativeId, Identity("lichess", "replacement")))
      val nativeAttempt = service.nativeGet(nativeId, nativeOwner, "token-a").get
      assertEquals(nativeAttempt.identity.map(_.subject), Some("player"))
      assert(service.nativeTake(nativeId, nativeAttempt))
      assert(!service.nativeTake(nativeId, nativeAttempt))
      val google = java.nio.file.Files.createTempFile("google-oauth-test", ".json")
      try
        java.nio.file.Files.writeString(credentials, """{"app_id":"123","secret_key":"test-secret"}""")
        java.nio.file.Files
          .writeString(google, """{"web":{"client_id":"test","client_secret":"test-secret"}}""")
        def configured(zaloFile: String, enabled: Boolean = true) = ExternalLogin(
          Configuration(
            "security.external.google.credentials_file" -> google.toString,
            "security.external.zalo.credentials_file" -> zaloFile,
            "security.external.zalo.enabled" -> enabled,
            "security.external.lichess.enabled" -> true,
            "security.external.lishogi.enabled" -> true
          ),
          net,
          ws,
          new lila.memo.CacheApi
        )
        assertEquals(
          configured(credentials.toString).providers.map(_.id),
          List("google", "zalo", "lichess", "lishogi")
        )
        assertEquals(
          configured(credentials.toString, enabled = false).providers.map(_.id),
          List("google", "lichess", "lishogi")
        )
        assertEquals(configured(credentials.toString, enabled = false).provider("zalo"), None)
        assertEquals(configured("").providers.map(_.id), List("google", "lichess", "lishogi"))
        java.nio.file.Files.writeString(credentials, """{"app_id":"invalid","secret_key":"private-value"}""")
        val invalid = intercept[IllegalArgumentException](configured(credentials.toString).providers)
        assertEquals(invalid.getMessage, "Invalid Zalo OAuth credential file")
      finally
        java.nio.file.Files.deleteIfExists(credentials)
        java.nio.file.Files.deleteIfExists(google)
      val base = s"http://127.0.0.1:${server.getAddress.getPort}"
      val provider = Provider(
        "lichess",
        "Lichess",
        s"$base/authorize",
        s"$base/token",
        s"$base/account",
        "test-client",
        Some("test-secret"),
        ""
      )
      def begin() = query(URI.create(service.begin(provider, "browser", Purpose.Login, "/study")).getRawQuery)
      def finish(state: String, browser: String = "browser", p: Provider = provider) =
        Await.result(service.complete(p, browser, state, "test-code"), 10.seconds)
      val params = begin()
      assert(!params.contains("client_secret"))
      assertNotEquals(params("state"), "test-secret")
      assertEquals(params("code_challenge_method"), "S256")
      val result = finish(params("state"))
      assertEquals(result.identity.key, "lichess:stable-user")
      assertEquals(result.returnTo, "/study")
      assertEquals(received.asScala.head("client_secret"), "test-secret")
      assertEquals(challenge(received.asScala.head("code_verifier")), params("code_challenge"))
      intercept[Failed](finish(params("state")))
      intercept[Failed](finish(begin()("state"), "other-browser"))
      intercept[Failed](finish(begin()("state"), p = provider.copy(id = "lishogi")))
      assertEquals(received.size(), 1)
      val zalo = provider.copy(
        id = "zalo",
        name = "Zalo",
        tokenUrl = s"$base/zalo/token",
        accountUrl = s"$base/zalo/account"
      )
      val zaloParams = query(
        URI
          .create(
            service.begin(zalo, "browser", Purpose.Link(UserId("local"), "session"), "/account/login-methods")
          )
          .getRawQuery
      )
      assertEquals(zaloParams.keySet, Set("app_id", "redirect_uri", "state", "code_challenge"))
      assertEquals(zaloParams("app_id"), "test-client")
      assertEquals(zaloParams("redirect_uri"), "https://local.test/auth/external/zalo/callback")
      val linked = finish(zaloParams("state"), p = zalo)
      assertEquals(linked.identity.key, "zalo:stable-user")
      assertEquals(linked.identity.verifiedEmail, None)
      assertEquals(linked.purpose, Purpose.Link(UserId("local"), "session"))
      val zaloExchange = zaloRequests.asScala.toList
      assertEquals(zaloExchange.head.keySet, Set("app_id", "code", "grant_type", "code_verifier"))
      assertEquals(zaloExchange.head("grant_type"), "authorization_code")
      assertEquals(challenge(zaloExchange.head("code_verifier")), zaloParams("code_challenge"))
      assertEquals(zaloExchange(1), Map("fields" -> "id"))
      intercept[Failed](finish(zaloParams("state"), p = zalo))
      zaloError = true
      val badZalo = query(URI.create(service.begin(zalo, "browser", Purpose.Login, "/")).getRawQuery)
      intercept[Failed](finish(badZalo("state"), p = zalo))
      assertEquals(zaloRequests.size(), 3) // No profile request after a token API error, even with HTTP 200.
      service.savePending("browser", result)
      // Reauthentication uses another browser binding without losing the identity being linked.
      service.savePending(
        "reauth-browser",
        result.copy(purpose = Purpose.Confirm(UserId("local"), "session"))
      )
      assert(service.takePending("reauth-browser").isDefined)
      assertEquals(service.getPending("browser"), Some(result))
      assertEquals(service.takePending("browser"), Some(result))
      assertEquals(service.takePending("browser"), None)
      val user = UserId("local")
      val change = service.saveChange(user, "session", "google", unlink = true)
      assertEquals(service.getChange(change, UserId("other"), "session"), None)
      assertEquals(service.takeChange(change, user, "other-session"), None)
      assertEquals(service.getChange(change, user, "session").map(_.provider), Some("google"))
      assertEquals(service.takeChange(change, user, "session").map(_.unlink), Some(true))
      assertEquals(service.takeChange(change, user, "session"), None)
    finally
      ws.close()
      Await.result(system.terminate(), 10.seconds)
      server.stop(0)
