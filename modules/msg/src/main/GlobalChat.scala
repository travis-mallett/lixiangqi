package lila.msg

import play.api.libs.json.*
import lila.common.Bus
import lila.common.Json.given
import lila.core.chat.PublicSource
import lila.core.notify.{ NotificationContent, NotifyApi }
import lila.core.socket.SendTos
import lila.db.dsl.{ *, given }
import lila.memo.CacheApi.*

object GlobalChat:
  export lila.core.msg.GlobalRoom.id
  val name = "Global Chat"
  val identity = Json.obj("id" -> id, "name" -> name, "group" -> true)
  def canPost(using me: Me) = me.enabled.yes && me.kid.no && me.noBot && !me.marks.troll

/** Public text has no private membership, attachment grants or per-reader receipt arrays. */
final class GlobalChat(
    colls: MsgColls,
    json: MsgJson,
    organization: MsgOrganization,
    contacts: ContactApi,
    relations: lila.core.relation.RelationApi,
    notifyApi: NotifyApi,
    spam: lila.core.security.SpamApi,
    shutupApi: lila.core.shutup.ShutupApi,
    cacheApi: lila.memo.CacheApi
)(using Executor, Scheduler, lila.core.config.RateLimit):
  import GlobalChat.*
  import BsonHandlers.{ *, given }
  private val selector = $doc("tid" -> id)
  private val readers = scalalib.cache.ExpireSetMemo[UserId](90.seconds)
  private val awaitingNotification = scalalib.cache.ExpireSetMemo[String](30.seconds)
  private val justRead = scalalib.cache.ExpireSetMemo[(UserId, String)](30.seconds)
  private val limit = lila.memo.RateLimit[UserId](20, 1.minute, "msg.global.write")
  private val store = MsgStore(colls.msg, colls.thread)
  private def fail[A](code: String): Fu[A] = fufail(MsgActionError(code))
  private def page(filter: Bdoc, size: Int, fields: Option[Bdoc] = None) =
    colls.globalIndex >> colls.msg
      .find(selector ++ filter, fields)
      .sort($doc("date" -> -1, "_id" -> -1))
      .cursor[Msg]()
      .list(size)

  private case class Latest(contact: JsObject, body: String, etag: String)
  private val latest = cacheApi.unit[Latest]("msg.global.latest"):
    _.expireAfterWrite(10.seconds).buildAsyncFuture: _ =>
      page($doc("deletedAt".$exists(false)), 12, Some($doc("user" -> 1, "text" -> 1, "date" -> 1))).map:
        rows =>
          val last = rows.headOption.fold(Msg.Last("", UserId.lichess, millisToInstant(1), true))(
            _.asLast.copy(read = true)
          )
          val contact =
            Json.obj("user" -> identity, "lastMsg" -> Json.toJson(last)(using MsgGroups.lastWrites))
          val body = Json.stringify(
            Json.obj(
              "msgs" -> rows.map(m =>
                Json.obj(
                  "user" -> m.user,
                  "text" -> lila.common.String.shorten(m.text, 320),
                  "id" -> m.id,
                  "date" -> m.date
                )
              )
            )
          )
          val digest = lila.memo.Attachment.sha(body.getBytes(java.nio.charset.StandardCharsets.UTF_8))
          Latest(contact, body, "\"" + digest + "\"")

  def preview = latest.get({}).map(s => s.body -> s.etag)
  def contact = latest.get({}).map(_.contact)

  def watch(using me: Me): Unit = if me.kid.no then readers.put(me.userId)
  def conversation(before: Option[Long], canModerate: Boolean)(using me: Me): Fu[JsObject] =
    if me.kid.yes then fail("notFound")
    else
      watch
      page(before.so(t => $doc("date".$lt(millisToInstant(t)))), 100).map: rows =>
        Json.obj(
          "user" -> identity,
          "msgs" -> rows.map(json.renderMsg),
          "postable" -> canPost,
          "canModerate" -> canModerate,
          "relations" -> Json.obj(),
          "pinned" -> Json.arr()
        )

  private[msg] def matching(filter: Bdoc)(using me: Me) =
    if me.kid.yes then fail("notFound")
    else
      page(filter, 51).map: docs =>
        val rows = docs.take(50)
        rows -> Option.when(docs.size > 50)(rows.last.date.toEpochMilli -> rows.last.id)

  private def validated(body: String)(using me: Me): Fu[Msg] =
    if !canPost then fail("rejected")
    else if lila.core.security.SubmissionPolicy.blocked(body) || spam.detect(body) then fail("unsafeLink")
    else if MsgGroups.mentions(body).size > 16 then fail("invalid")
    else Msg.make(body.trim, me, nowInstant).fold(fail[Msg]("invalid"))(fuccess)

  private def changed(m: Msg, kind: String): Unit =
    latest.invalidate({})
    Bus.pub(
      SendTos(
        readers.keys.toSet + m.user,
        "msgChanged",
        Json.obj("user" -> id, "kind" -> kind, "msg" -> json.renderMsg(m))
      )
    )

  def send(body: String, nonce: String)(using me: Me): Fu[Msg] =
    limit(me.userId, fail[Msg]("limited")):
      if !nonce.matches("[a-zA-Z0-9-]{16,64}") then fail("invalid")
      else
        validated(body).flatMap: clean =>
          val digest = lila.memo.Attachment.sha(body.getBytes(java.nio.charset.StandardCharsets.UTF_8))
          val m = clean.copy(id = s"${me.userId}_$nonce", requestDigest = Some(digest))
          colls.msg.insert
            .one(writeMsg(m, MsgThread.Id(id)))
            .flatMap: _ =>
              awaitingNotification.put(m.id)
              changed(m, "new")
              shutupApi.publicText(me, m.text, PublicSource.GlobalChat)
              summon[Scheduler].scheduleOnce(5.seconds) {
                colls.msg
                  .one[Msg](selector ++ $id(m.id) ++ $doc("deletedAt".$exists(false)))
                  .flatMap(_.so(notifyRecipients))
                  .failed
                  .foreach(e => logger.error("Global chat notification failed", e))
              }
              fuccess(m)
            .recoverWith(
              lila.db.recoverDuplicateKey(_ =>
                colls.msg
                  .one[Msg](selector ++ $id(m.id) ++ $doc("requestDigest" -> digest))
                  .flatMap(_.fold(fail[Msg]("conflict"))(fuccess))
              )
            )

  private def notifyRecipients(m: Msg): Funit =
    for
      candidates <- organization.globalRecipients(MsgGroups.mentions(m.text))
      active <- candidates.nonEmpty.so(contacts.adultIds((candidates - m.user).toList))
      blocked <- active.nonEmpty.so(relations.filterBlocked(m.user, active))
      blocking <- active.nonEmpty.so(relations.filterBlocking(active, m.user))
      recipients = (active -- blocked -- blocking).filterNot(u => justRead.get(u -> m.id))
      fresh <- recipients.nonEmpty.so(
        colls.msg.exists(selector ++ $id(m.id) ++ $doc("revision" -> m.revision, "deletedAt".$exists(false)))
      )
      _ <- fresh.so(
        notifyApi.notifyMany(
          recipients,
          NotificationContent
            .PrivateMessage(m.user, lila.common.String.shorten(m.text, 40), Some(id), Some(name), Some(m.id))
        )
      )
      _ <- fresh.so:
        colls.msg
          .exists(selector ++ $id(m.id) ++ $doc("revision" -> m.revision))
          .flatMap:
            case false => notifyApi.removeMessage(id, m.id)
            case true =>
              recipients
                .filter(u => justRead.get(u -> m.id))
                .toList
                .sequentiallyVoid(u => notifyApi.markRead(u, $doc("content.messageId" -> m.id)))
    yield ()

  def update(mid: String, revision: Int, action: String, value: String, canModerate: Boolean)(using
      me: Me
  ): Fu[Msg] =
    limit(me.userId, fail[Msg]("limited")):
      for
        old <- colls.msg.one[Msg](selector ++ $id(mid)).flatMap(_.fold(fail[Msg]("notFound"))(fuccess))
        _ <- if revision == old.revision then funit else fail[Unit]("conflict")
        at = nowInstant
        next <- action match
          case "deleteEveryone"
              if me.kid.no && old.deletedAt.isEmpty && (old.canDeleteForEveryone(me, at) || canModerate) =>
            fuccess(old.copy(deletedAt = Some(at)))
          case "edit" if old.canEdit(me, at) =>
            validated(value).map(m =>
              old.copy(
                text = m.text,
                editedAt = Some(at),
                history = old.history :+ Msg.Version(old.text, old.editedAt.getOrElse(old.date))
              )
            )
          case _ => fail[Msg]("rejected")
        saved = next.copy(revision = revision + 1)
        ok <- store.saveVisible(selector, me, old, saved, hide = false)
        _ <- if ok then notifyApi.removeMessage(id, mid) else fail[Unit]("conflict")
      yield
        changed(saved, "update")
        if action == "edit" then shutupApi.publicText(me, saved.text, PublicSource.GlobalChat)
        saved

  def acknowledge(ids: List[String], read: Boolean)(using me: Me): Fu[JsObject] =
    if me.kid.yes || ids.size > 100 then fail("invalid")
    else
      val now = nowInstant
      if read then ids.filter(awaitingNotification.get).foreach(mid => justRead.put(me.userId -> mid))
      read
        .so(notifyApi.markRead(me.userId, $doc("content.thread" -> id, "content.messageId".$in(ids))))
        .map: _ =>
          Json.obj(
            "user" -> id,
            "receipts" -> ids.map(mid => Json.obj("id" -> mid, "readAt" -> read.option(now)))
          )
