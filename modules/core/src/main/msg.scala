package lila.core
package msg

import lila.core.userId.UserId
import lila.core.data.Url

object GlobalRoom:
  // Private groups use random version-4 UUIDs. The nil UUID identifies the public room.
  val id = "~00000000000000000000000000000000"
  val resource = s"inbox/group/$id"
  val path = s"/$resource"

enum PostResult:
  case Success, Invalid, Limited, Bounced, UnsafeLink

  def rejection: Option[String] = this match
    case Success => None
    case UnsafeLink => Some(security.SubmissionPolicy.unsafeLink)
    case Limited => Some("limited")
    case Invalid => Some("invalid")
    case Bounced => Some("rejected")

case class MsgPreset(name: String, text: String)

case class SystemMsg(userId: UserId, text: String)

case class PayoutMessages(
    userIds: List[UserId],
    tourName: String,
    tourUrl: Url,
    finishedAt: Instant = nowInstant
)

type ID = String

case class IdText(id: String, text: String)

trait MsgApi:
  def postPreset(destId: UserId, preset: MsgPreset): Fu[PostResult]
  def post(
      orig: UserId,
      dest: UserId,
      text: String,
      multi: Boolean = false,
      date: Instant = nowInstant,
      ignoreSecurity: Boolean = false
  ): Fu[PostResult]
  def systemPost(destId: UserId, text: String): Fu[PostResult]
