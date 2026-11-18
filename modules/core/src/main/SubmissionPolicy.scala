package lila.core.security

/** High-confidence rules shared by all user-authored communication. No I/O, account lookup or model call. */
object SubmissionPolicy:
  val unsafeLink = "unsafeLink"
  private val destination =
    """(?i)(?<![a-z0-9_-])chess-bot\.com(?![\p{L}\p{N}_-]|\.[a-z0-9-])""".r
  private val credential =
    """(?i)/(?:auth/magic-link/login|auth/token|signup/confirm|password/reset/confirm)/""".r

  def blocked(text: String): Boolean =
    (text.indexOf('.') >= 0 && destination.findFirstIn(text).isDefined) ||
      (text.indexOf('/') >= 0 && credential.findFirstIn(text).isDefined)

  def check(text: String): Unit = if blocked(text) then throw SubmissionRejected(unsafeLink)

case class SubmissionRejected(code: String)
    extends RuntimeException(code)
    with scala.util.control.NoStackTrace
