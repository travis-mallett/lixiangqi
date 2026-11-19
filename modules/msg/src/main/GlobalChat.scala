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

/** The public room has bounded previews and presence without a per-message membership snapshot. */
final class GlobalChat(
    colls: MsgColls,
    json: MsgJson,
    organization: MsgOrganization,
    groups: MsgGroups,
    media: MsgMedia,
    attachments: lila.memo.Attachments,
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
      page($doc("deletedAt".$exists(false)), 12, Some($doc("history" -> 0))).map: rows =>
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
                "date" -> m.date,
                "attachments" -> m.attachments,
                "reactions" -> m.reactions.groupMapReduce(_.emoji)(_ => 1)(_ + _),
                "pollCounts" -> m.card
                  .flatMap(_.poll)
                  .map(p => p.options.indices.map(i => p.votes.count(_.choices.contains(i)))),
                "card" -> m.card.map(c => c.copy(poll = c.poll.map(_.copy(votes = Nil))))
              )
            )
          )
        )
        val digest = lila.memo.Attachment.sha(body.getBytes(java.nio.charset.StandardCharsets.UTF_8))
        Latest(contact, body, "\"" + digest + "\"")

  def preview = latest.get({}).map(s => s.body -> s.etag)
  def contact = latest.get({}).map(_.contact)

  def unwatch(user: UserId): Unit = readers.remove(user)
  def watch(using me: Me): Unit = if me.kid.no then readers.put(me.userId)
  private val typingLimit = lila.memo.RateLimit[UserId](40, 1.minute, "msg.global.typing")
  def typing(active: Boolean)(using me: Me): Funit =
    typingLimit(me.userId, funit):
      if canPost && readers.get(me.userId) then
        Bus.pub(
          SendTos(
            readers.keys.toSet - me.userId,
            "msgTyping",
            Json.obj("user" -> id, "sender" -> me.userId, "active" -> active)
          )
        )
      funit

  def conversation(before: Option[Long], canModerate: Boolean, compact: Boolean)(using me: Me): Fu[JsObject] =
    if me.kid.yes then fail("notFound")
    else
      watch
      for
        rows <- page(before.so(t => $doc("date".$lt(millisToInstant(t)))), if compact then 12 else 100)
        pins <- colls.pinnedIndex >> colls.msg
          .find(selector ++ $doc("pinnedAt".$exists(true), "deletedAt".$exists(false)))
          .sort($sort.desc("pinnedAt"))
          .cursor[Msg]()
          .list(3)
      yield Json.obj(
        "user" -> identity,
        "msgs" -> rows.map(json.renderMsg),
        "postable" -> canPost,
        "canModerate" -> canModerate,
        "relations" -> Json.obj(),
        "pinned" -> pins.map(json.renderMsg)
      )

  private[msg] def matching(filter: Bdoc)(using me: Me) =
    if me.kid.yes then fail("notFound")
    else
      page(filter, 51).map: docs =>
        val rows = docs.take(50)
        rows -> Option.when(docs.size > 50)(rows.last.date.toEpochMilli -> rows.last.id)

  private def validated(body: String, handles: List[String])(using me: Me): Fu[Msg] =
    if !canPost then fail("rejected")
    else if lila.core.security.SubmissionPolicy.blocked(body) || spam.detect(body) then fail("unsafeLink")
    else if MsgGroups.mentions(body).size > 16 then fail("invalid")
    else Msg.make(body.trim, me, nowInstant, handles).fold(fail[Msg]("invalid"))(fuccess)

  private def changed(m: Msg, kind: String): Unit =
    latest.invalidate({})
    Bus.pub(
      SendTos(
        readers.keys.toSet + m.user,
        "msgChanged",
        Json.obj("user" -> id, "kind" -> kind, "msg" -> json.renderMsg(m))
      )
    )

  def mediaAllowed(using me: Me): Boolean = canPost && !me.marks.alt

  def canReadAttachment(parent: String, owner: UserId, handle: String): Fu[Boolean] =
    colls.msg.exists(
      selector ++ $id(parent) ++ $doc("user" -> owner, "attachments" -> handle, "deletedAt".$exists(false))
    )

  def send(
      body: String,
      nonce: String,
      reply: Option[String],
      items: List[String],
      forward: Option[(String, String)],
      cardJson: Option[String]
  )(using me: Me): Fu[Msg] =
    limit(me.userId, fail[Msg]("limited")):
      if !canPost || !nonce.matches("[a-zA-Z0-9-]{16,64}") then fail("invalid")
      else
        val mid = s"${me.userId}_$nonce"
        val rich = reply.nonEmpty || items.nonEmpty || forward.nonEmpty || cardJson.nonEmpty
        val payload = if rich then
          Json.stringify(Json.arr(body, reply, items, forward.map(_._1), forward.map(_._2), cardJson))
        else body
        val digest = lila.memo.Attachment.sha(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8))
        def existing = colls.msg
          .one[Msg](selector ++ $id(mid))
          .flatMap:
            case Some(m) if !m.requestDigest.contains(digest) => fail[Option[Msg]]("conflict")
            case found => fuccess(found)
        def publish = for
          card <- MsgCard.decode(cardJson, body, items)
          forwarded <- forward.traverse((peer, id) => groups.source(peer, id))
          _ <-
            if forwarded.forall(_.canForward) && (forwarded.isEmpty || (items.isEmpty && card.isEmpty))
            then funit
            else fail[Unit]("invalid")
          handles <- forwarded.filter(_.attachments.nonEmpty) match
            case Some(src) if mediaAllowed && attachments.enabled("msg") =>
              media.copy(me, forward.get._1, src, id, mid)
            case Some(_) => fail[List[String]]("attachmentsUnavailable")
            case None => fuccess(items)
          clean <- validated(forwarded.fold(body)(_.text), handles)
          quote <- reply.traverse(key =>
            colls.msg
              .one[Msg](selector ++ $id(key) ++ $doc("deletedAt".$exists(false)))
              .flatMap(_.fold(fail[Msg]("notFound"))(fuccess))
          )
          m = clean.copy(
            id = mid,
            requestDigest = Some(digest),
            forwarded = forwarded.nonEmpty,
            card = forwarded.flatMap(_.card).orElse(card),
            reply = quote.map(q => Msg.Quote(q.id, q.user, q.text.take(1000)))
          )
          doc = writeMsg(m, MsgThread.Id(id))
          _ <-
            if handles.isEmpty then colls.msg.insert.one(doc).void
            else
              attachments.transaction: tx =>
                val msgs: Coll = tx.collection(colls.msg.name)
                for
                  _ <-
                    if mediaAllowed then contacts.guardMedia(tx, List(me.userId))
                    else fail[Unit]("privateTextOnly")
                  _ <- forward.zip(forwarded).so((peer, src) => media.guardForward(tx, me, peer._1, src))
                  _ <- attachments.prepare(me, s"msg/$id", mid, 0, handles, transaction = Some(tx))
                  _ <- msgs.insert.one(doc)
                yield ()
        yield
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
          m
        existing.flatMap(
          _.fold(
            publish.recoverWith(
              lila.db.recoverDuplicateKey(_ => existing.flatMap(_.fold(fail[Msg]("conflict"))(fuccess)))
            )
          )(fuccess)
        )

  private def notifyRecipients(m: Msg): Funit =
    for
      candidates <- organization.globalRecipients(MsgGroups.mentions(m.text))
      active <- candidates.nonEmpty.so(contacts.adultIds((candidates - m.user).toList))
      blocked <- active.nonEmpty.so(relations.filterBlocked(m.user, active))
      blocking <- active.nonEmpty.so(relations.filterBlocking(active, m.user))
      recipients = (active -- blocked -- blocking).filterNot(u => justRead.get(u -> m.id))
      fresh <- recipients.nonEmpty.so(
        colls.msg.exists(selector ++ $id(m.id) ++ $doc("text" -> m.text, "deletedAt".$exists(false)))
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
          .exists(selector ++ $id(m.id) ++ $doc("text" -> m.text, "deletedAt".$exists(false)))
          .flatMap:
            case false => notifyApi.removeMessage(id, m.id)
            case true =>
              recipients
                .filter(u => justRead.get(u -> m.id))
                .toList
                .sequentiallyVoid(u => notifyApi.markRead(u, $doc("content.messageId" -> m.id)))
    yield ()

  def update(
      mid: String,
      revision: Int,
      action: String,
      value: String,
      canModerate: Boolean,
      replacement: Option[List[String]]
  )(using
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
            fuccess(old.copy(deletedAt = Some(at), pinnedAt = None))
          case "react" if canPost && old.deletedAt.isEmpty && MsgActions.validReaction(value) =>
            fuccess(
              old.copy(reactions =
                old.reactions.filterNot(_.user.is(me)) ++ value.nonEmpty.option(Msg.Reaction(me, value))
              )
            )
          case "vote" | "endPoll" if canPost => MsgCard.pollAction(old, me, action, value)
          case "pin" if canModerate && old.deletedAt.isEmpty =>
            fuccess(old.copy(pinnedAt = Option.when(value == "true")(at)))
          case "edit" if old.canEdit(me, at) =>
            validated(value, replacement.getOrElse(old.attachments)).map(m =>
              old.copy(
                text = m.text,
                attachments = m.attachments,
                card = None,
                editedAt = Some(at),
                history = old.history :+ Msg.Version(old.text, old.editedAt.getOrElse(old.date))
              )
            )
          case _ => fail[Msg]("rejected")
        saved = next.copy(revision = revision + 1)
        _ <-
          def persist(s: MsgStore) = s
            .saveVisible(selector, me, old, saved, hide = false)
            .flatMap(ok => if ok then funit else fail[Unit]("conflict"))
          if action == "edit" && saved.attachments.nonEmpty then
            attachments.transaction: tx =>
              for
                _ <-
                  if mediaAllowed then contacts.guardMedia(tx, List(me.userId))
                  else fail[Unit]("privateTextOnly")
                _ <- attachments.prepare(
                  me,
                  s"msg/$id",
                  mid,
                  saved.revision.toLong,
                  saved.attachments,
                  transaction = Some(tx)
                )
                _ <- persist(MsgStore(tx.collection(colls.msg.name), colls.thread))
              yield ()
          else persist(store)
        _ <- (action == "pin" && value == "true").so(trimPins())
        _ <- (action == "edit" || action == "deleteEveryone").so(notifyApi.removeMessage(id, mid))
      yield
        changed(saved, "update")
        if action == "edit" then shutupApi.publicText(me, saved.text, PublicSource.GlobalChat)
        saved

  private def trimPins(): Funit =
    (colls.pinnedIndex >> colls.msg
      .find(selector ++ $doc("pinnedAt".$exists(true)))
      .sort($doc("pinnedAt" -> -1, "_id" -> -1))
      .cursor[Msg]()
      .list(100)).flatMap:
      _.drop(3).sequentiallyVoid: pin =>
        colls.msg.update
          .one(
            selector ++ $id(pin.id) ++ $doc("pinnedAt" -> pin.pinnedAt),
            $unset("pinnedAt") ++ $inc("revision" -> 1)
          )
          .flatMap: result =>
            (result.nModified > 0).so(colls.msg.byId[Msg](pin.id).map(_.foreach(changed(_, "update"))))

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
