package controllers

import play.api.libs.json.*
import play.api.mvc.Result

import lila.app.{ *, given }
import lila.core.security.{ SubmissionPolicy, SubmissionRejected }
import lila.core.id.{ ForumCategId, ForumTopicId }
import lila.memo.Attachment as Item
import lila.oauth.OAuthScope

final class Attachment(env: Env) extends LilaController(env):
  private def store = env.memo.attachments
  private val uploads =
    lila.memo.RateLimit[UserId](store.hourlyUploads, 1.hour, "ugc.upload")(using env.net.rateLimit)
  private def scopes(surface: String, writing: Boolean = true): Seq[OAuthScope.Selector] = surface match
    case "msg" if writing => Seq(_.Msg.Write, _.Mobile.Inbox, _.Web.Mobile)
    case "msg" => Seq(_.Mobile.Inbox, _.Web.Mobile)
    case "forum" => Seq(_.Mobile.Forum)
    case _ => Nil

  private def forumTarget(dest: String): Option[(ForumCategId, Option[ForumTopicId])] =
    dest.split("~", -1) match
      case Array(board, topic) if board.nonEmpty && topic.nonEmpty =>
        Some(ForumCategId(board) -> Option.unless(topic == "new")(ForumTopicId(topic)))
      case _ => None

  private def audience(surface: String, dest: String) =
    s"$surface/${if surface == "forum" then dest.replace('~', '/') else dest}"

  private def eligible(surface: String, dest: String)(using Context, Me): Fu[Boolean] =
    if !store.enabled(surface) || dest.length > 150 then fuFalse
    else
      surface match
        case "msg" => env.msg.api.mediaAllowed(summon[Me], UserId(dest))
        case "forum" => forumTarget(dest).so((c, t) => env.forum.media.canStage(c, t))
        case _ => fuFalse

  private def unavailable(code: String) = UnprocessableEntity(jsonError(code))
  private val protectedHeaders = Seq(
    "Cache-Control" -> "private, no-store",
    "X-Content-Type-Options" -> "nosniff",
    "Content-Security-Policy" -> "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy" -> "same-origin",
    "Vary" -> "Cookie, Authorization"
  )

  def policy(surface: String, dest: String) = AuthOrScoped(scopes(surface)*) { ctx ?=> me ?=>
    eligible(surface, dest).map(allowed =>
      Ok(Json.obj("enabled" -> allowed, "maxBytes" -> store.maxBytes, "maxCount" -> store.maxCount))
        .withHeaders(protectedHeaders*)
    )
  }

  def upload(surface: String, dest: String) =
    AuthOrScopedBodyWithParser(parse.byteString(store.maxBytes.toLong))(scopes(surface)*) { ctx ?=> me ?=>
      uploads(me.userId, rateLimited):
        eligible(surface, dest).flatMap:
          case false => fuccess(Forbidden(jsonError("attachmentsUnavailable")))
          case true =>
            val name = ctx.req.headers
              .get("X-Attachment-Name")
              .flatMap: encoded =>
                scala.util
                  .Try(java.net.URLDecoder.decode(encoded, java.nio.charset.StandardCharsets.UTF_8))
                  .toOption
            val bytes = ctx.body.body.toArray
            val document = name.exists(n =>
              Set("txt", "pgn").contains(
                n.split('.').lastOption.getOrElse("").toLowerCase(java.util.Locale.ROOT)
              )
            )
            if document && SubmissionPolicy.blocked(
                new String(bytes, java.nio.charset.StandardCharsets.UTF_8)
              )
            then fuccess(unavailable("unsafeLink"))
            else
              store
                .stage(me, audience(surface, dest), name.getOrElse(""), bytes)
                .map(i => Created(draft(i)))
                .recover { case SubmissionRejected(code) =>
                  unavailable(code)
                }
    }

  private def draft(i: Item): JsObject = Json.obj(
    "id" -> i.id,
    "name" -> i.name,
    "size" -> i.size,
    "state" -> (if i.state == "restricted" then "blocked"
                else if i.review.contains("requested") then "checking"
                else i.state),
    "reviewable" -> (i.state == "blocked" && i.reason.contains("imagePolicy") && i.review.isEmpty)
  )

  def status(surface: String, dest: String, id: String) = AuthOrScoped(scopes(surface)*) { ctx ?=> me ?=>
    eligible(surface, dest).flatMap:
      case false => fuccess(NotFound)
      case true =>
        store.owned(id, me, audience(surface, dest)).flatMap {
          case Some(i) if i.state == "checking" =>
            store.available.map(up =>
              Ok(draft(i) ++ Json.obj("state" -> (if up then "checking" else "retry")))
                .withHeaders(protectedHeaders*)
            )
          case item => fuccess(item.fold[Result](NotFound)(i => Ok(draft(i)).withHeaders(protectedHeaders*)))
        }
  }

  def action(surface: String, dest: String, id: String) = AuthOrScopedBody(scopes(surface)*) { ctx ?=> me ?=>
    val aud = audience(surface, dest)
    get("action") match
      case Some("remove") => store.remove(id, me, aud).inject(NoContent)
      case Some("review") =>
        store
          .requestReview(id, me, aud)
          .flatMap:
            case Some(digest) =>
              env.report.evidence
                .record(
                  lila.report.EvidenceItem(me, aud, id, 0, digest, Nil, surface == "msg", "review requested")
                )
                .flatMap: evidence =>
                  env.report.api
                    .autoCommFlag(
                      lila.core.report.SuspectId(me),
                      s"evidence/${evidence.id}",
                      "Blocked attachment: author requested review"
                    )
                    .inject(Ok)
            case None => fuccess(Conflict)
      case Some("retry") =>
        eligible(surface, dest).flatMap:
          if _ then store.retry(id, me, aud).map(ok => if ok then Ok else Conflict)
          else fuccess(NotFound)
      case _ => fuccess(BadRequest)
  }

  private def readable(i: Item, parent: String)(using ctx: Context): Fu[Boolean] =
    i.audience.split("/") match
      case Array("msg", dest) =>
        ctx.me.soUse: me ?=>
          env.msg.actions.canReadAttachment(i.owner, UserId(dest), parent, i.id)
      case Array("forum", board, _) if ctx.kid.no =>
        env.forum.postApi
          .get(ForumPostId(parent))
          .flatMap:
            case Some((topic, post))
                if topic.categId == ForumCategId(board) && env.forum.media.publicBoard(topic.categId) &&
                  !post.erased && post.visibleBy(ctx.me) && post.attachments.exists(_.contains(i.id)) =>
              env.forum.access.isGrantedRead(topic.categId)
            case _ => fuFalse
      case _ => fuFalse

  def read(surface: String, id: String) = OpenOrScoped(scopes(surface, writing = false)*) {
    store
      .get(id)
      .flatMap:
        case Some(i)
            if i.audience.startsWith(surface + "/") && i.state == "ready" && i.policy == Item.policy =>
          i.parent
            .so(readable(i, _))
            .flatMap:
              case false => fuccess(NotFound)
              case true if getBool("meta") =>
                fuccess(Ok(Json.obj("name" -> i.name, "mime" -> i.mime, "size" -> i.size)))
              case true =>
                store
                  .approvedBytes(i)
                  .map:
                    case None => NotFound
                    case Some(bytes) =>
                      val image = i.mime.contains("image/webp")
                      val disposition = if image then "inline" else "attachment"
                      val encoded = java.net.URLEncoder
                        .encode(i.name, java.nio.charset.StandardCharsets.UTF_8)
                        .replace("+", "%20")
                      Ok(bytes)
                        .as(if image then "image/webp" else "application/octet-stream")
                        .withHeaders("Content-Disposition" -> s"$disposition; filename*=UTF-8''$encoded")
        case _ => fuccess(NotFound)
      .map(_.withHeaders(protectedHeaders*))
  }
