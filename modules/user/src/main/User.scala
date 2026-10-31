package lila.user

import java.time.Duration

import lila.core.perf.UserWithPerfs
import lila.core.user.{ Emails, PlayTime }

case class WithPerfsAndEmails(user: UserWithPerfs, emails: Emails)

opaque type TotpToken = String
object TotpToken extends OpaqueString[TotpToken]

case class UserDelete(requested: Instant, done: Boolean = false)

case class ClosedFlags(forever: Boolean, deleted: Boolean)

object PlayTime:
  extension (p: PlayTime)
    def totalDuration = Duration.ofSeconds(p.total)
    def tvDuration = Duration.ofSeconds(p.tv)
    def nonEmptyTvDuration = Option.when(p.tv > 0)(p.tvDuration)

object nameRules:
  // what new usernames should be like -- now split into further parts for clearer error messages
  val newUsernameRegex = lila.core.UsernameRules.signup
  val newUsernamePrefix = lila.core.UsernameRules.prefix
  val newUsernameSuffix = lila.core.UsernameRules.suffix
  val newUsernameChars = lila.core.UsernameRules.chars
  val newUsernameLetters = lila.core.UsernameRules.separators
