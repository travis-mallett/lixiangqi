package lila.security

import java.nio.charset.StandardCharsets.UTF_8
import java.security.{ KeyPairGenerator, Signature }
import java.util.Base64
import play.api.libs.json.*

class GoogleNativeLoginTest extends munit.FunSuite:
  private val pair = KeyPairGenerator.getInstance("RSA").generateKeyPair()
  private val now = 1_800_000_000_000L
  private val audience = "mobile-test.apps.googleusercontent.com"
  private val claims = Json.obj(
    "iss" -> "https://accounts.google.com",
    "aud" -> audience,
    "sub" -> "google-subject",
    "iat" -> (now / 1000 - 10),
    "exp" -> (now / 1000 + 3600),
    "email" -> "tester@gmail.com",
    "email_verified" -> true
  )
  private def encoded(bytes: Array[Byte]) = Base64.getUrlEncoder.withoutPadding.encodeToString(bytes)
  private def token(payload: JsObject = claims, algorithm: String = "RS256"): String =
    val content = encoded(Json.obj("alg" -> algorithm, "kid" -> "test").toString.getBytes(UTF_8)) + "." +
      encoded(payload.toString.getBytes(UTF_8))
    val signer = Signature.getInstance("SHA256withRSA")
    signer.initSign(pair.getPrivate)
    signer.update(content.getBytes(UTF_8))
    content + "." + encoded(signer.sign())

  private def verify(raw: String) = GoogleNativeLogin.verifyWithKey(raw, audience, pair.getPublic, now)

  test("native and browser Google identities use the same stable subject and trusted email"):
    assertEquals(Some(verify(token())), ExternalLogin.readIdentity("google", claims))
    assertEquals(verify(token()).verifiedEmail.map(_.value), Some("tester@gmail.com"))

  test("both documented Google issuers are accepted"):
    assertEquals(verify(token(claims ++ Json.obj("iss" -> "accounts.google.com"))).subject, "google-subject")

  test("wrong audience, issuer, expiry, future issue time and missing claims fail closed"):
    val invalid = List(
      claims ++ Json.obj("aud" -> "another-client"),
      claims ++ Json.obj("iss" -> "https://attacker.example"),
      claims ++ Json.obj("exp" -> (now / 1000)),
      claims ++ Json.obj("iat" -> (now / 1000 + 300)),
      claims - "exp",
      claims - "iat",
      claims - "sub"
    )
    invalid.foreach: payload =>
      intercept[GoogleNativeLogin.InvalidCredential](verify(token(payload)))

  test("invalid signature and algorithm are rejected"):
    val otherKey = KeyPairGenerator.getInstance("RSA").generateKeyPair().getPublic
    intercept[GoogleNativeLogin.InvalidCredential]:
      GoogleNativeLogin.verifyWithKey(token(), audience, otherKey, now)
    intercept[GoogleNativeLogin.InvalidCredential](verify(token(algorithm = "none")))

  test("third-party email cannot bypass LiXiangQi email verification"):
    assertEquals(verify(token(claims ++ Json.obj("email" -> "user@example.com"))).verifiedEmail, None)
    assertEquals(verify(token(claims ++ Json.obj("email_verified" -> false))).verifiedEmail, None)

  test("malformed tokens fail without echoing credentials"):
    val raw = "private-credential"
    val failure = intercept[GoogleNativeLogin.InvalidCredential](verify(raw))
    assert(!failure.toString.contains(raw))
    assertEquals(failure.getCause, null)
