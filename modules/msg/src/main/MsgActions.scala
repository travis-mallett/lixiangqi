package lila.msg

import play.api.libs.json.*
import reactivemongo.api.bson.BSONRegex

import lila.common.Bus
import lila.common.Json.given
import lila.core.socket.{ SendTo, makeMessage }
import lila.db.dsl.{ *, given }

/** The shared mutation contract for the browser and native inbox. All message selectors bind the
  * authenticated participant and conversation. Content is never destroyed by a participant's deletion.
  */
final class MsgActions(
    colls: MsgColls,
    api: MsgApi,
    groups: MsgGroups,
    globalChat: GlobalChat,
    media: MsgMedia,
    json: MsgJson,
    security: MsgSecurity,
    contactApi: ContactApi,
    shutupApi: lila.core.shutup.ShutupApi,
    attachments: lila.memo.Attachments,
    notifier: MsgNotify
)(using Executor, lila.core.config.RateLimit):

  import BsonHandlers.given

  private val limit = lila.memo.RateLimit[UserId](120, 1.minute, "msg.action")
  private val typingLimit = lila.memo.RateLimit[UserId](40, 1.minute, "msg.typing")
  private val receiptLimit = lila.memo.RateLimit[UserId](300, 1.minute, "msg.receipt")
  private val store = MsgStore(colls.msg, colls.thread)

  private def visible(contact: UserId)(using me: Me) =
    store.visible(me, contact)

  private def message(contact: UserId, id: String)(using Me): Fu[Msg] =
    colls.msg
      .one[Msg](visible(contact) ++ $id(id))
      .flatMap:
        case Some(msg) => fuccess(msg)
        case None => fufail(MsgActionError("notFound"))

  def visibleMessage(contact: UserId, id: String)(using me: Me): Fu[Option[Msg]] =
    val scopes = List(visible(contact), $doc("audience" -> me.userId, "del".$ne(me.userId))) ++
      me.kid.no.option($doc("tid" -> GlobalChat.id))
    colls.msg
      .one[Bdoc]($or(scopes*) ++ $id(id) ++ $doc("user" -> contact, "deletedAt".$exists(false)))
      .flatMap:
        case None => fuccess(None)
        case Some(doc) =>
          val tid = doc.string("tid").get
          val msg = BsonHandlers.msgHandler.read(doc)
          if tid == GlobalChat.id then fuccess(Some(msg))
          else if MsgGroups.validId(tid) then
            groups.source(tid, id).map(Some(_)).recover { case _: MsgActionError => None }
          else api.withVisibleMedia(msg, me, contact).map(Some(_))

  def history(chat: String, query: String, files: Boolean, before: Option[Long], cursor: String)(using
      me: Me
  ): Fu[JsObject] =
    val term = query.trim
    if term.length > 200 || (!files && term.isEmpty) then fuccess(Json.obj("msgs" -> Json.arr()))
    else
      limit(me.userId, fail[JsObject]("limited")):
        val search = if files then $doc("attachments.0".$exists(true))
        else $doc("text" -> BSONRegex(java.util.regex.Pattern.quote(term), "i"))
        val filter = search ++ $doc("deletedAt".$exists(false)) ++ before.so: stamp =>
          val at = millisToInstant(stamp)
          $or($doc("date".$lt(at)), $doc("date" -> at, "_id".$lt(cursor)))
        val result = if chat == GlobalChat.id then globalChat.matching(filter)
        else if MsgGroups.validId(chat) then groups.matching(chat, filter)
        else
          val peer = UserId(chat)
          for
            docs <- colls.msg
              .find(visible(peer) ++ filter)
              .sort($doc("date" -> -1, "_id" -> -1))
              .cursor[Msg]()
              .list(51)
            page = docs.take(50)
            allowed <- page
              .filter(_.attachments.nonEmpty)
              .map(_.user)
              .distinct
              .filterA(author => media.direct(author, if author.is(me) then peer else me.userId))
            rows = page.map(m =>
              if m.attachments.isEmpty || allowed.contains(m.user) then m else m.copy(attachments = Nil)
            )
          yield rows -> Option.when(docs.size > 50)(page.last.date.toEpochMilli -> page.last.id)
        result.map: (rows, next) =>
          Json.obj(
            "msgs" -> rows.filter(m => !files || m.attachments.nonEmpty).map(json.renderMsg),
            "next" -> next.map((t, id) => Json.obj("before" -> t, "id" -> id))
          )

  def canReadAttachment(author: UserId, recipient: UserId, parent: String, handle: String)(using me: Me) =
    store.canReadAttachment(me, author, recipient, parent, handle)(api.mediaAllowed(author, recipient))

  private def fail[A](code: String): Fu[A] = fufail(MsgActionError(code))

  def send(
      contact: UserId,
      text: String,
      nonce: String,
      replyId: Option[String],
      forwardId: Option[String],
      forwardUser: Option[UserId],
      attachmentIds: List[String] = Nil,
      cardJson: Option[String] = None
  )(using me: Me): Fu[Msg] =
    if !nonce.matches("[a-zA-Z0-9-]{16,64}") || text.length > 8000 || contact.is(me) then fail("invalid")
    else
      val id = s"${me.userId}_$nonce"
      val fingerprint = lila.memo.Attachment.sha(
        Json
          .stringify(
            JsArray(
              Json.arr(text, replyId, forwardId, forwardUser.map(_.value), attachmentIds).value ++ cardJson
                .map(JsString.apply)
            )
          )
          .getBytes(java.nio.charset.StandardCharsets.UTF_8)
      )
      def existing = colls.msg.one[Msg]($id(id) ++ $doc("tid" -> MsgThread.id(me, contact))).flatMap {
        case Some(m) if m.requestDigest.exists(_ != fingerprint) => fail[Option[Msg]]("conflict")
        case Some(m) if m.attachments.nonEmpty =>
          api.withVisibleMedia(m, me, contact).map(Some(_))
        case m => fuccess(m)
      }
      def create = for
        card <- MsgCard.decode(cardJson, text, attachmentIds)
        _ <- if forwardId.nonEmpty && card.nonEmpty then fail[Unit]("invalid") else funit
        quote <- replyId
          .traverse(message(contact, _))
          .map(
            _.filter(_.deletedAt.isEmpty)
              .map(m => Msg.Quote(m.id, m.user, m.text.take(1000)))
          )
        _ <-
          if quote.exists(q => lila.core.security.SubmissionPolicy.blocked(q.text)) then
            fail[Unit]("unsafeLink")
          else funit
        forwarded <- forwardId.traverse: fid =>
          forwardUser.fold(fail[Msg]("invalid"))(u => groups.source(u.value, fid))
        _ <- if !forwarded.forall(_.canForward) then fail[Unit]("invalid") else funit
        ids <- forwarded.filter(_.attachments.nonEmpty) match
          case Some(src) if attachmentIds.isEmpty && attachments.enabled("msg") =>
            api.requireMedia(me, contact) >> media.copy(me, forwardUser.get.value, src, contact.value, id)
          case _
              if forwarded.isDefined && (attachmentIds.nonEmpty || forwarded.exists(
                _.attachments.nonEmpty
              )) =>
            fail[List[String]]("attachmentsUnavailable")
          case _ => fuccess(attachmentIds)
        result <- api.postWithMeta(
          me,
          contact,
          forwarded.fold(text)(_.text),
          messageId = Some(id),
          reply = quote,
          forwarded = forwarded.isDefined,
          attachmentIds = ids,
          requestDigest = Some(fingerprint),
          forwardSource = forwardUser.zip(forwarded),
          card = forwarded.flatMap(_.card).orElse(card)
        )
        _ <- result.rejection.fold(funit)(fail[Unit])
        saved <- existing.flatMap(_.fold(fail[Msg]("notFound"))(fuccess))
      yield saved
      existing.flatMap:
        case Some(msg) => fuccess(msg) // A retry after a lost response cannot duplicate a send.
        case None =>
          create.recoverWith(
            lila.db.recoverDuplicateKey(_ => existing.flatMap(_.fold(fail[Msg]("conflict"))(fuccess)))
          )

  def update(
      contact: UserId,
      id: String,
      action: String,
      value: String,
      revision: Int,
      attachmentIds: Option[List[String]] = None
  )(using
      me: Me
  ): Fu[Msg] =
    limit(me.userId, fail[Msg]("limited")):
      for
        old <- message(contact, id)
        _ <- if old.revision != revision then fail[Unit]("conflict") else funit
        requested = attachmentIds.getOrElse(old.attachments)
        next <- change(
          contact,
          if action == "edit" then old.copy(attachments = requested) else old,
          action,
          value
        )
        saved <-
          if action == "edit" && requested.nonEmpty then
            attachments.transaction: tx =>
              contactApi.guardMedia(tx, List(me.userId, contact)) >> api.requireMedia(me, contact) >>
                attachments.prepare(
                  me,
                  s"msg/$contact",
                  old.id,
                  revision.toLong + 1,
                  requested,
                  transaction = Some(tx)
                ) >>
                MsgStore(tx.collection(colls.msg.name), tx.collection(colls.thread.name))
                  .save(me, contact, old, next, hide = false)
                  .flatMap(ok => if ok then fuTrue else fail[Boolean]("conflict"))
          else store.save(me, contact, old, next, hide = action == "deleteMe")
        _ <- if !saved then fail[Unit]("conflict") else funit
        _ = if action == "edit" then shutupApi.privateMessage(me, contact, next.text)
        _ <-
          if action == "edit" || action == "deleteEveryone" then updatePreviews(contact, old, next) else funit
        _ <-
          if action == "deleteEveryone" || action == "edit" then notifier.onContentChange(contact, old).void
          else funit
        _ <- if action == "deleteMe" then refreshPreview(contact) >> hideUnread(contact, old) else funit
        otherVisible <- colls.msg.exists($id(id) ++ store.visible(contact, me))
        _ <- if action == "pin" && value == "true" then trimPins(contact) else funit
        visible <- api.withVisibleMedia(next, me, contact)
      yield
        if action == "deleteMe" then emit(me, "msgRemoved", Json.obj("user" -> contact, "id" -> id))
        else
          emit(
            me,
            "msgChanged",
            Json.obj("user" -> contact, "msg" -> json.renderMsg(visible), "kind" -> "update")
          )
          if otherVisible then
            emit(
              contact,
              "msgChanged",
              Json.obj("user" -> me.userId, "msg" -> json.renderMsg(visible), "kind" -> "update")
            )
        visible

  private def change(contact: UserId, old: Msg, action: String, value: String)(using me: Me): Fu[Msg] =
    val now = nowInstant
    val next = old.copy(revision = old.revision + 1)
    action match
      case "deleteMe" => fuccess(old)
      case "deleteEveryone" if old.canDeleteForEveryone(me, now) =>
        fuccess(next.copy(deletedAt = Some(now), pinnedAt = None))
      case "edit" if lila.core.security.SubmissionPolicy.blocked(value) =>
        fail(lila.core.security.SubmissionPolicy.unsafeLink)
      case "edit" if old.canEdit(me, now) && value.length <= 8000 =>
        Msg
          .make(value, me, now, old.attachments)
          .fold(fail[Msg]("invalid")): cleaned =>
            contactApi
              .contacts(me, contact)
              .flatMap:
                case None => fail("rejected")
                case Some(contacts) =>
                  security.can
                    .post(contacts, cleaned.text, isNew = false, hasAttachments = old.attachments.nonEmpty)
                    .flatMap:
                      case MsgSecurity.Ok | MsgSecurity.TrollFriend =>
                        fuccess(
                          next.copy(
                            text = cleaned.text,
                            card = None,
                            editedAt = Some(now),
                            history = old.history :+ Msg.Version(old.text, old.editedAt.getOrElse(old.date))
                          )
                        )
                      case MsgSecurity.Limit => fail("limited")
                      case _ => fail("rejected")
      case "vote" | "endPoll" =>
        security.may
          .post(me, contact, isNew = false)
          .flatMap(ok => if ok then MsgCard.pollAction(next, me, action, value) else fail("rejected"))
      case "react" if old.deletedAt.isEmpty && MsgActions.validReaction(value) =>
        security.may
          .post(me, contact, isNew = false)
          .flatMap:
            case false => fail("rejected")
            case true =>
              fuccess(
                next.copy(reactions =
                  old.reactions.filterNot(_.user.is(me)) :::
                    value.nonEmpty.option(Msg.Reaction(me, value)).toList
                )
              )
      case "pin" if old.deletedAt.isEmpty =>
        security.may
          .post(me, contact, isNew = false)
          .flatMap:
            case false => fail("rejected")
            case true => fuccess(next.copy(pinnedAt = if value == "true" then Some(now) else None))
      case _ => fail("rejected")

  // Only acknowledgements for concrete downloaded messages can advance receipts.
  // Fetching/prefetching a conversation is deliberately read-only.
  def acknowledge(contact: UserId, ids: List[String], read: Boolean)(using me: Me): Fu[List[Msg]] =
    if ids.isEmpty || ids.size > 100 then fuccess(Nil)
    else
      receiptLimit(me.userId, fail[List[Msg]]("limited")):
        for
          saved <- store.acknowledge(me, contact, ids.distinct, read, nowInstant)
          marked <- if read then store.markThreadRead(me, contact, saved) else fuFalse
          _ <- if marked then notifier.onRead(me, contact) else funit
        yield
          if saved.nonEmpty then
            emit(contact, "msgReceipt", Json.obj("user" -> me.userId, "receipts" -> saved.map(json.receipt)))
            emit(me, "msgReceipt", Json.obj("user" -> contact, "receipts" -> saved.map(json.receipt)))
          saved

  private def trimPins(contact: UserId)(using me: Me): Funit =
    val selector = $doc("tid" -> MsgThread.id(me, contact), "pinnedAt".$exists(true))
    (colls.pinnedIndex >> colls.msg.find(selector).sort($sort.desc("pinnedAt")).cursor[Msg]().list(100))
      .flatMap: pins =>
        pins
          .drop(3)
          .sequentiallyVoid: old =>
            colls.msg.update
              .one(
                $id(old.id) ++ $doc("pinnedAt" -> old.pinnedAt),
                $unset("pinnedAt") ++ $inc("revision" -> 1)
              )
              .flatMap: changed =>
                if changed.nModified == 0 then funit
                else
                  colls.msg
                    .byId[Msg](old.id)
                    .flatMapz: next =>
                      api
                        .withVisibleMedia(next, me, contact)
                        .flatMap: payload =>
                          List(me.userId, contact).sequentiallyVoid: user =>
                            colls.msg
                              .exists($id(old.id) ++ $doc("del".$ne(user)))
                              .map: visible =>
                                if visible then
                                  emit(
                                    user,
                                    "msgChanged",
                                    Json.obj(
                                      "user" -> (if user.is(me) then contact else me.userId),
                                      "msg" -> json.renderMsg(payload),
                                      "kind" -> "update"
                                    )
                                  )

  def typing(contact: UserId, active: Boolean)(using me: Me): Funit =
    typingLimit(me.userId, funit):
      security.may
        .post(me, contact, isNew = false)
        .map:
          case true => emit(contact, "msgTyping", Json.obj("user" -> me.userId, "active" -> active))
          case false => ()

  private def refreshPreview(contact: UserId)(using me: Me): Funit =
    // A per-user preview prevents a locally deleted last message leaking back into
    // the inbox. Other participants retain their own view.
    colls.msg
      .find(visible(contact))
      .sort($sort.desc("date"))
      .cursor[Msg]()
      .list(1)
      .flatMap:
        case Nil =>
          colls.thread.update.one($id(MsgThread.id(me, contact)), $addToSet("del" -> me.userId)).void
        case msg :: _ =>
          colls.thread.update
            .one($id(MsgThread.id(me, contact)), $set(s"preview.${me.userId}" -> msg.asLast))
            .void

  private def updatePreviews(contact: UserId, old: Msg, next: Msg)(using me: Me): Funit =
    List("lastMsg", "maskWith", s"preview.${me.userId}", s"preview.$contact").sequentiallyVoid: field =>
      colls.thread.update
        .one(
          $id(MsgThread.id(me, contact)) ++
            $doc(s"$field.user" -> old.user, s"$field.date" -> old.date),
          $set(
            $doc(s"$field.text" -> next.asLast.text, s"$field.deleted" -> next.deletedAt.isDefined) ++
              (if next.deletedAt.isDefined then $doc(s"$field.read" -> true) else $empty)
          )
        )
        .void

  private def hideUnread(contact: UserId, msg: Msg)(using me: Me): Funit =
    if msg.user != contact then funit
    else
      colls.thread.update
        .one(
          $id(MsgThread.id(me, contact)) ++
            $doc("lastMsg.user" -> contact, "lastMsg.date" -> msg.date),
          $set("lastMsg.read" -> true)
        )
        .flatMap: result =>
          (result.nModified > 0).so(notifier.onRead(me, contact))

  private def emit(user: UserId, typ: String, data: JsObject): Unit =
    Bus.pub(SendTo(user, makeMessage(typ, data)))

object MsgActions:
  // One Unicode grapheme, with an emoji code point; reject text and control strings.
  def validReaction(value: String): Boolean =
    value.isEmpty || (value.length <= 32 && value.matches("\\X") &&
      value
        .codePoints()
        .anyMatch(cp =>
          cp >= 0x1f000 || (cp >= 0x2300 && cp <= 0x2bff) || cp == 0x00a9 || cp == 0x00ae || cp == 0x20e3
        ))

case class MsgActionError(code: String) extends RuntimeException(code)
