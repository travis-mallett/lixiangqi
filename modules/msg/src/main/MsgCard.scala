package lila.msg

import play.api.libs.json.*

/** Optional structured content. The ordinary message body remains readable by older clients. */
case class PollBallot(user: String, choices: List[Int])
case class MsgPoll(
    question: String,
    options: List[String],
    multiple: Boolean,
    votes: List[PollBallot],
    ended: Boolean
)
case class MsgPreview(url: String, title: String, description: String, date: Option[Long] = None)
case class MsgCard(poll: Option[MsgPoll], contact: Option[String], preview: Option[MsgPreview])

object MsgCard:
  given OFormat[PollBallot] = Json.format
  given OFormat[MsgPoll] = Json.format
  given OFormat[MsgPreview] = Json.format
  given OFormat[MsgCard] = Json.format

  def decode(raw: Option[String], body: String, attachments: List[String]): Fu[Option[MsgCard]] =
    raw match
      case None => fuccess(None)
      case Some(value) =>
        scala.util.Try(Json.parse(value).as[MsgCard]).toOption.filter(valid(_, body, attachments)) match
          case Some(card) => fuccess(Some(card))
          case None => fufail(MsgActionError("invalid"))

  private def valid(card: MsgCard, body: String, attachments: List[String]): Boolean =
    def label(s: String, max: Int) = s.nonEmpty && s.trim == s && s.length <= max && !s.exists(_.isControl)
    (card.poll, card.contact, card.preview) match
      case (Some(p), None, None) =>
        attachments.isEmpty && p.votes.isEmpty && !p.ended && label(p.question, 100) &&
        p.options.size >= 2 && p.options.size <= 10 && p.options.forall(label(_, 100)) &&
        body == (p.question :: p.options).mkString("\n")
      case (None, Some(name), None) =>
        attachments.isEmpty && lila.core.UsernameRules.existing.matches(name) && body == "@" + name
      case (None, None, Some(link)) =>
        attachments.size <= 1 && LinkPreview
          .validUrl(link.url) && matchesLink(body, link.url) &&
        link.date.forall(d =>
          d > 0 && d < 32503680000000L
        ) && link.title.nonEmpty && link.title.length <= 300 && link.description.length <= 1000 &&
        !lila.core.security.SubmissionPolicy.blocked(link.title + " " + link.description)
      case _ => false

  private def matchesLink(body: String, url: String): Boolean =
    val quoted = java.util.regex.Pattern.quote(url)
    (s"""(?:^|[\\s(\\[<"'])$quoted(?=$$|[\\s)\\]>"']|[.,!?;:](?:\\s|$$))""").r.findFirstIn(body).isDefined

  def pollAction(msg: Msg, actor: UserId, action: String, value: String): Fu[Msg] =
    val updated = for
      card <- msg.card if msg.deletedAt.isEmpty
      poll <- card.poll if !poll.ended
      next <- action match
        case "endPoll" if msg.user == actor => Some(poll.copy(ended = true))
        case "vote" =>
          scala.util
            .Try(Json.parse(value).as[List[Int]])
            .toOption
            .filter { choices =>
              (poll.multiple || choices.size <= 1) && choices.distinct == choices && choices.forall(
                poll.options.indices.contains
              )
            }
            .map { choices =>
              val others = poll.votes.filterNot(_.user == actor.value)
              poll.copy(votes = others ++ choices.nonEmpty.option(PollBallot(actor.value, choices)))
            }
        case _ => None
    yield msg.copy(card = Some(card.copy(poll = Some(next))))
    updated.fold(fufail[Msg](MsgActionError("rejected")))(fuccess)
