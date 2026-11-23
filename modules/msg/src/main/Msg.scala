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
    requestDigest: Option[String] = None,
    card: Option[MsgCard] = None,
    welcomeUser: Option[UserName] = None
):

  def recipient(first: UserId, second: UserId): UserId = if user == first then second else first

  def canDeleteForEveryone(actor: UserId, now: Instant): Boolean =
    welcomeUser.isEmpty && actor == user && deletedAt.isEmpty && !date.isBefore(now.minusSeconds(24 * 3600))

  def canEdit(actor: UserId, now: Instant): Boolean =
    card.forall(_.preview.nonEmpty) && canDeleteForEveryone(actor, now) && history.size < 10

  def canForward = welcomeUser.isEmpty && deletedAt.isEmpty && card.forall(_.poll.isEmpty)

  def asLast =
    Msg.Last(
      text = if deletedAt.isDefined then "" else text.take(60),
      user = user,
      date = date,
      read = readAt.isDefined,
      id = Some(id),
      deleted = deletedAt.isDefined,
      deliveredAt = deliveredAt,
      readAt = readAt
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
      deleted: Boolean = false,
      deliveredAt: Option[Instant] = None,
      readAt: Option[Instant] = None
  ):
    def unreadBy(userId: UserId) = !read && user != userId

  def make(
      text: String,
      user: UserId,
      date: Instant,
      attachments: List[String] = Nil,
      hasBoard: Boolean = false
  ): Option[Msg] =
    val cleanText = lila.common.String.softCleanUp(text.take(8_000))
    (cleanText.nonEmpty || attachments.nonEmpty || hasBoard).option(
      Msg(
        text = cleanText,
        attachments = attachments,
        user = user,
        date = date
      )
    )
