package lila.security

import java.math.BigInteger
import java.security.{ KeyFactory, PublicKey }
import java.security.spec.RSAPublicKeySpec
import java.util.Base64

import com.google.api.client.json.gson.GsonFactory
import com.google.api.client.json.webtoken.JsonWebSignature
import com.google.auth.oauth2.TokenVerifier
import play.api.libs.json.*
import play.api.libs.ws.StandaloneWSClient

/** Native Google credentials use the same subject and email policy as browser login. Fetch public keys
  * asynchronously; Google's verifier performs the cryptographic checks locally.
  */
final class GoogleNativeLogin(
    ws: StandaloneWSClient,
    cache: lila.memo.CacheApi,
    clientId: () => Option[String]
)(using
    Executor
):
  import GoogleNativeLogin.*

  private val keys = cache[String, Map[String, PublicKey]](1, "google.native.keys"):
    _.expireAfterWrite(1.hour).buildAsyncFuture: _ =>
      ws.url("https://www.googleapis.com/oauth2/v3/certs")
        .withRequestTimeout(10.seconds)
        .withFollowRedirects(false)
        .get()
        .map: response =>
          if response.status != 200 then throw InvalidCredential()
          (Json.parse(response.body) \ "keys")
            .as[List[JsValue]]
            .filter(k => (k \ "kty").asOpt[String].contains("RSA"))
            .map: k =>
              def integer(name: String) = BigInteger(1, Base64.getUrlDecoder.decode((k \ name).as[String]))
              (k \ "kid").as[String] -> KeyFactory
                .getInstance("RSA")
                .generatePublic(RSAPublicKeySpec(integer("n"), integer("e")))
            .toMap

  def verify(raw: String): Fu[ExternalLogin.Identity] =
    scala.util
      .Try:
        val audience = clientId().getOrElse(throw InvalidCredential())
        val parsed = parse(raw)
        validateClaims(parsed, audience, System.currentTimeMillis())
        audience -> parsed.getHeader.getKeyId
      .fold(
        _ => fufail(InvalidCredential()),
        (audience, kid) =>
          keys
            .get("google")
            .map: publicKeys =>
              verifyWithKey(raw, audience, publicKeys.getOrElse(kid, throw InvalidCredential()))
      )

object GoogleNativeLogin:
  case class InvalidCredential() extends Exception("Invalid Google credential")
  private val json = GsonFactory.getDefaultInstance

  private def parse(raw: String): JsonWebSignature =
    if raw.isEmpty || raw.length > 8192 then throw InvalidCredential()
    JsonWebSignature.parse(json, raw)

  private def validateClaims(token: JsonWebSignature, audience: String, now: Long): Unit =
    val p = token.getPayload
    if token.getHeader.getAlgorithm != "RS256" || p.getAudience != audience ||
      !Set("https://accounts.google.com", "accounts.google.com").contains(p.getIssuer) ||
      p.getExpirationTimeSeconds == null || p.getExpirationTimeSeconds <= now / 1000 ||
      p.getIssuedAtTimeSeconds == null || p.getIssuedAtTimeSeconds > now / 1000 + 60
    then throw InvalidCredential()

  private[security] def verifyWithKey(
      raw: String,
      audience: String,
      key: PublicKey,
      now: Long = System.currentTimeMillis()
  ): ExternalLogin.Identity =
    try
      val parsed = parse(raw)
      validateClaims(parsed, audience, now)
      val verified = TokenVerifier
        .newBuilder()
        .setAudience(audience)
        .setIssuer(parsed.getPayload.getIssuer)
        .setPublicKey(key)
        .setClock(() => now)
        .build()
        .verify(raw)
      ExternalLogin
        .readIdentity("google", Json.parse(json.toString(verified.getPayload)))
        .getOrElse(throw InvalidCredential())
    catch case scala.util.control.NonFatal(_) => throw InvalidCredential()
