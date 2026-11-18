package lila.msg

case class Msg(
    text: String,
    user: UserId,
    date: Instant,
    id: String = scalalib.ThreadLocalRandom.nextString(16),
    reply: Option[Msg.Quote] = None,
    forwarded: Boolean = false,
    history: List[Msg.Version] = Nil,
    editedAt: Option[Instant] = None,
    deliveredAt: Option[Instant] = None,
    readAt: Option[Instant] = None,
    deletedAt: Option[Instant] = None,
    reactions: List[Msg.Reaction] = Nil,
    pinnedAt: Option[Instant] = None,
    revision: Int = 0,
    attachments: List[String] = Nil,
    requestDigest: Option[String] = None
):

  def recipient(first: UserId, second: UserId): UserId = if user == first then second else first

  def canDeleteForEveryone(actor: UserId, now: Instant): Boolean =
    actor == user && deletedAt.isEmpty && !date.isBefore(now.minusSeconds(24 * 3600))

  def canEdit(actor: UserId, now: Instant): Boolean =
    canDeleteForEveryone(actor, now) && history.size < 10

  def asLast =
    Msg.Last(
      text = if deletedAt.isDefined then "" else text.take(60),
      user = user,
      date = date,
      read = readAt.isDefined,
      id = Some(id),
      deleted = deletedAt.isDefined
    )

object Msg:

  case class Quote(id: String, user: UserId, text: String)
  case class Version(text: String, date: Instant)
  case class Reaction(user: UserId, emoji: String)

  case class Last(
      text: String,
      user: UserId,
      date: Instant,
      read: Boolean,
      id: Option[String] = None,
      deleted: Boolean = false
  ):
    def unreadBy(userId: UserId) = !read && user != userId

  def make(text: String, user: UserId, date: Instant, attachments: List[String] = Nil): Option[Msg] =
    val cleanText = lila.common.String.softCleanUp(text.take(8_000))
    (cleanText.nonEmpty || attachments.nonEmpty).option(
      Msg(
        text = cleanText,
        attachments = attachments,
        user = user,
        date = date
      )
    )
