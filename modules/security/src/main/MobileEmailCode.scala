package lila.security

import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger

import play.api.i18n.Lang
import play.api.mvc.RequestHeader
import scalalib.SecureRandom

import lila.common.HTTPRequest
import lila.core.i18n.I18nKey.emails as trans
import lila.core.net.IpAddress
import lila.mailer.Mailer
import lila.memo.RateLimit

/** Short-lived, purpose-bound proofs. Lost on restart; never persisted or logged. */
private[security] final class MobileEmailChallenges(clock: () => Long = () => System.currentTimeMillis())(
    using Executor
):
  private case class Challenge(email: String, purpose: String, hash: Array[Byte], expires: Long):
    val attempts = AtomicInteger(0)

  private val entries = lila.memo.CacheApi.scaffeineNoScheduler
    .maximumSize(10000)
    .expireAfterWrite(10.minutes)
    .build[String, Challenge]()

  private def hash(id: String, code: String) =
    MessageDigest.getInstance("SHA-256").digest(s"$id:$code".getBytes(UTF_8))

  def create(email: EmailAddress, purpose: String): (String, String) =
    val id = SecureRandom.nextString(32)
    val code = f"${new java.security.SecureRandom().nextInt(1000000)}%06d"
    entries.put(id, Challenge(email.normalize.value, purpose, hash(id, code), clock() + 10.minutes.toMillis))
    id -> code

  def consume(id: String, code: String, email: EmailAddress, purpose: String): Boolean = synchronized:
    entries
      .getIfPresent(id)
      .exists: entry =>
        val valid = entry.expires > clock() && entry.attempts.incrementAndGet() <= 5 &&
          entry.email == email.normalize.value && entry.purpose == purpose &&
          MessageDigest.isEqual(entry.hash, hash(id, code))
        if valid || entry.attempts.get() >= 5 || entry.expires <= clock() then entries.invalidate(id)
        valid

final class MobileEmailCode(mailer: Mailer)(using Executor, lila.core.i18n.Translator):
  // Always enforced, including development: this endpoint can send real email.
  private given lila.core.config.RateLimit = lila.core.config.RateLimit.Yes
  private val perIp = RateLimit[IpAddress](10, 1.hour, "mobile.email.ip")
  private val perEmail = RateLimit[String](3, 1.hour, "mobile.email.address", log = false)
  private val global = RateLimit[String](200, 1.hour, "mobile.email.global")
  private val challenges = MobileEmailChallenges()

  enum Result:
    case Sent(id: String)
    case Limited, Unavailable

  def send(email: EmailAddress, purpose: String)(using RequestHeader, Lang): Fu[Result] =
    val limited = fuccess(Result.Limited)
    perIp(HTTPRequest.ipAddress(summon[RequestHeader]), limited):
      perEmail(email.normalize.value, limited):
        global("all", limited):
          if !mailer.canSend || email.isNoReply then fuccess(Result.Unavailable)
          else
            val (id, code) = challenges.create(email, purpose)
            mailer
              .sendOrFail(
                Mailer.Message(
                  to = email,
                  subject = trans.mobileVerificationSubject.txt(),
                  text = Mailer.txt.addServiceNote(trans.mobileVerificationBody.txt(code))
                )
              )
              .inject(Result.Sent(id))
              .recover { case _: Exception => Result.Unavailable }

  def consume(id: String, code: String, email: EmailAddress, purpose: String): Boolean =
    challenges.consume(id, code, email, purpose)
