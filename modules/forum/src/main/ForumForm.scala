package lila.forum

import play.api.data.*
import play.api.data.Forms.*

import lila.common.Form.given
import lila.common.Form.{ cleanText, into }

final private[forum] class ForumForm(
    promotion: lila.core.security.PromotionApi,
    val captcha: lila.core.captcha.CaptchaApi
):

  import ForumForm.*

  def postMapping(inOwnTeam: Boolean)(using Me) =
    mapping(
      "text" -> userTextMapping(inOwnTeam),
      "gameId" -> of[GameId],
      "move" -> text,
      "modIcon" -> optional(boolean),
      "attachments" -> optional(text(maxLength = 264)),
      "nonce" -> optional(text(minLength = 16, maxLength = 64))
    )(PostData.apply)(unapply)
      .verifying("error.minLength", d => d.text.length >= 3 || (d.ids.nonEmpty && d.nonce.isDefined))
      .verifying(lila.core.captcha.failMessage, captcha.validateSync)

  def post(inOwnTeam: Boolean)(using Me) = Form(postMapping(inOwnTeam))

  def postEdit(inOwnTeam: Boolean, previousText: String)(using Me) =
    Form:
      mapping(
        "changes" -> userTextMapping(inOwnTeam, previousText.some),
        "revision" -> optional(longNumber(min = 0L)),
        "attachments" -> optional(text(maxLength = 264)),
        "replaceAttachments" -> optional(boolean)
      )(PostEdit.apply)(unapply)

  def postWithCaptcha(inOwnTeam: Boolean)(using Me) = post(inOwnTeam) -> captcha.any

  def topic(inOwnTeam: Boolean)(using Me) =
    Form:
      mapping(
        "name" -> cleanText(minLength = 3, maxLength = 100)
          .verifying("unsafeLink", !lila.core.security.SubmissionPolicy.blocked(_)),
        "post" -> postMapping(inOwnTeam)
      )(TopicData.apply)(unapply)

  val deleteWithReason = Form:
    single("reason" -> optional(nonEmptyText))

  val relocateTo = Form:
    single("categ" -> nonEmptyText.into[ForumCategId])

  private def userTextMapping(inOwnTeam: Boolean, previousText: Option[String] = None)(using me: Me) =
    text(maxLength = 50_000)
      .transform[String](lila.common.String.softCleanUp, identity)
      .verifying("unsafeLink", !lila.core.security.SubmissionPolicy.blocked(_))
      .verifying(
        "You have reached the daily maximum for links in forum posts.",
        t => inOwnTeam || promotion.test(me, t, previousText)
      )
      .transform(_.replace("\r\n", "\n").replace('\r', '\n'), identity)

  val diagnostic = Form(
    mapping(
      "text" -> nonEmptyText(maxLength = 3_000_000), // high cap only used for bot move dumps
      "plaintext" -> optional(boolean)
    )(DiagnosticData.apply)(unapply)
  )

object ForumForm:

  case class PostData(
      text: String,
      gameId: GameId,
      move: String,
      modIcon: Option[Boolean],
      attachments: Option[String] = None,
      nonce: Option[String] = None
  ) extends lila.core.captcha.WithCaptcha:
    def digest(subject: String = ""): Option[String] = nonce.map { _ =>
      val value = play.api.libs.json.Json.arr(subject, text, modIcon, ids)
      lila.memo.Attachment.sha(
        play.api.libs.json.Json.stringify(value).getBytes(java.nio.charset.StandardCharsets.UTF_8)
      )
    }
    def ids: List[String] = attachments.toList.flatMap(_.split(',')).filter(_.nonEmpty)

  case class TopicData(
      name: String,
      post: PostData
  ):
    def automodText = s"$name\n${post.text}"

  case class PostEdit(
      changes: String,
      revision: Option[Long],
      attachments: Option[String],
      replaceAttachments: Option[Boolean]
  )
  case class DiagnosticData(text: String, plaintext: Option[Boolean])
