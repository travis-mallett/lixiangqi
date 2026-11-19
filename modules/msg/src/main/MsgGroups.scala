package lila.msg

import play.api.libs.json.*
import reactivemongo.api.bson.{ BSONDocumentHandler, Macros }
import reactivemongo.api.bson.Macros.Annotations.Key
import lila.common.Bus
import lila.common.Json.given
import lila.core.notify.NotifyApi
import lila.core.socket.{ SendTo, makeMessage }
import lila.db.dsl.{ *, given }

private case class MsgGroup(
    @Key("_id") id: String,
    name: String,
    admins: List[UserId],
    users: List[UserId],
    updatedAt: Instant,
    previews: Map[String, Msg.Last],
    version: Int = 0,
    hidden: List[UserId] = Nil,
    description: Option[String] = None,
    inviteToken: Option[String] = None,
    adminAddOnly: Boolean = true,
    approval: Boolean = false,
    requests: List[UserId] = Nil
):
  def changeAdmin(target: UserId, promote: Boolean): Option[List[UserId]] =
    Option
      .when(users.contains(target)):
        if promote then (target :: admins).distinct else admins.filterNot(_ == target)
      .filter(_.nonEmpty)

  def remainingAdmins(remaining: List[UserId]): List[UserId] = admins.intersect(remaining) match
    case Nil => remaining.take(1)
    case retained => retained

  def identity = Json.obj("id" -> id, "name" -> name, "group" -> true)
  def contact(me: UserId) =
    Json.obj("user" -> identity, "lastMsg" -> Json.toJson(previews(me.value))(using MsgGroups.lastWrites))

object MsgGroups:
  private[msg] given lastWrites: OWrites[Msg.Last] = Json.writes
  def validId(id: String) = id.matches("~[a-z0-9]{32}")
  private val mention = """(?U)(?<![\w-])@([\w-]+)""".r
  private[msg] def mentions(text: String) =
    mention.findAllMatchIn(text).map(m => UserStr(m.group(1)).id).toSet

/** A group has one history. An immutable audience on each message prevents later additions from receiving old
  * messages or quotes. Membership and message publication share a transaction.
  */
final class MsgGroups(
    colls: MsgColls,
    json: MsgJson,
    relationApi: lila.core.relation.RelationApi,
    lightUserApi: lila.core.user.LightUserApi,
    contactApi: ContactApi,
    security: MsgSecurity,
    attachments: lila.memo.Attachments,
    media: MsgMedia,
    notifier: MsgNotify,
    notifyApi: NotifyApi,
    shutupApi: lila.core.shutup.ShutupApi
)(using Executor, lila.core.config.RateLimit):
  import BsonHandlers.{ *, given }
  import GroupMessages.{ message, visible }
  private given BSONDocumentHandler[MsgGroup] = Macros.handler
  private val limit = lila.memo.RateLimit[UserId](120, 1.minute, "msg.group.action")
  private val createLimit = lila.memo.RateLimit[UserId](12, 1.hour, "msg.group.create")
  private val maxMembers = 32
  private def fail[A](code: String = "rejected"): Fu[A] = fufail(MsgActionError(code))
  private def check(ok: Boolean, code: String = "rejected") = if ok then funit else fail[Unit](code)

  private def membership(id: String)(using me: Me) = $id(id) ++ $doc("users" -> me.userId)
  private def room(id: String)(using me: Me): Fu[MsgGroup] =
    if !MsgGroups.validId(id) then fail("notFound")
    else colls.group.one[MsgGroup](membership(id)).flatMap(_.fold(fail[MsgGroup]("notFound"))(fuccess))
  private def emit(users: Iterable[UserId], kind: String, data: JsObject) =
    users.foreach(u => Bus.pub(SendTo(u, makeMessage(kind, data))))
  private def refresh(users: Iterable[UserId], id: String) = emit(users, "msgInbox", Json.obj("user" -> id))

  def friends(using me: Me): Fu[List[lila.core.LightUser]] =
    if me.kid.yes then fuccess(Nil)
    else
      relationApi
        .fetchFriends(me)
        .flatMap(ids => lightUserApi.asyncMany(ids.toList.sorted(using stringOrdering)))
        .map(_.flatten)

  private def eligible(peer: UserId, text: Option[String])(using me: Me): Fu[Boolean] =
    contactApi
      .contacts(me, peer)
      .flatMapz: pair =>
        (!pair.any(c => !c.enabled.contains(true))).so:
          text match
            case None => security.may.post(pair, isNew = true)
            case Some(body) =>
              security.can
                .post(
                  pair,
                  body,
                  isNew = false,
                  unlimited = true,
                  inGroup = true,
                  hasAttachments = body.isEmpty
                )
                .map(v => v == MsgSecurity.Ok || v == MsgSecurity.TrollFriend)

  private def invitees(ids: List[UserId])(using me: Me) = for
    _ <- check(ids.nonEmpty && ids.size < maxMembers)
    blocked <- relationApi.filterBlocked(me.userId, ids)
    _ <- check(blocked.isEmpty)
    allowed <- ids.traverse(eligible(_, None))
    _ <- check(allowed.forall(identity))
  yield ()

  def create(raw: String, members: List[UserId])(using me: Me): Fu[String] =
    createLimit(me.userId, fail[String]("limited")):
      val id = "~" + java.util.UUID.randomUUID().toString.replace("-", "")
      val name = lila.common.String.softCleanUp(raw).trim
      val others = members.distinct.filterNot(_.is(me))
      val users = me.userId :: others
      val now = nowInstant
      val preview = Msg.Last("", me, now, read = true)
      for
        _ <- check(
          !me.kid.yes && name.nonEmpty && name.length <= 64 && !lila.core.security.SubmissionPolicy
            .blocked(name)
        )
        _ <- invitees(others)
        _ <- colls.group.insert.one(
          MsgGroup(
            id,
            name,
            List(me.userId),
            users,
            now,
            users.map(_.value -> preview).toMap,
            adminAddOnly = false
          )
        )
      yield
        refresh(users, id)
        id

  def contacts(before: Option[Instant], max: Int, filter: Bdoc = $empty)(using
      me: Me
  ): Fu[List[(Instant, JsObject)]] =
    colls.mailboxIndexes >> colls.group
      .find(
        filter ++ $doc("users" -> me.userId, "hidden".$ne(me.userId)) ++ before.so(at =>
          $doc(s"previews.${me.userId}.date".$lt(at))
        )
      )
      .sort($sort.desc(s"previews.${me.userId}.date"))
      .cursor[MsgGroup]()
      .list(max)
      .map(_.map(g => g.previews(me.userId.value).date -> g.contact(me)))

  def conversation(id: String, before: Option[Long])(using me: Me): Fu[JsObject] = for
    g <- room(id)
    selector = visible(id, me)
    msgs <- colls.msg
      .find(selector ++ before.so(t => $doc("date".$lt(millisToInstant(t)))))
      .sort($sort.desc("date"))
      .cursor[Bdoc]()
      .list(100)
    pins <- colls.pinnedIndex >> colls.msg
      .find(selector ++ $doc("pinnedAt".$exists(true), "deletedAt".$exists(false)))
      .sort($sort.desc("pinnedAt"))
      .cursor[Bdoc]()
      .list(3)
    allowed <- media.visibleGroupMedia(msgs ++ pins, me)
    users <- lightUserApi.asyncMany(g.users)
  yield Json.obj(
    "user" -> g.identity,
    "members" -> users.flatten,
    "admins" -> g.admins,
    "inviteToken" -> g.inviteToken.filter(_ => g.admins.contains(me.userId)),
    "approval" -> g.approval,
    "adminAddOnly" -> g.adminAddOnly,
    "requests" -> g.requests.filter(_ => g.admins.contains(me.userId)),
    "description" -> g.description,
    "msgs" -> msgs.map(d => json.renderMsg(visibleMessage(d, me, allowed))),
    "pinned" -> pins.map(d => json.renderMsg(visibleMessage(d, me, allowed))),
    "postable" -> (g.users.size > 1),
    "relations" -> Json.obj()
  )

  private def visibleMessage(doc: Bdoc, viewer: UserId, allowed: Set[String]): Msg =
    val msg = message(doc, viewer)
    if msg.attachments.isEmpty || allowed(msg.id) then msg else msg.copy(attachments = Nil)

  def revokeMedia(user: UserId): Funit =
    colls.group
      .distinctEasy[String, List]("_id", $doc("users" -> user))
      .map: rooms =>
        rooms.foreach(id => emit(List(user), "msgMediaRevoked", Json.obj("user" -> id)))

  private[msg] def matching(id: String, filter: Bdoc)(using me: Me): Fu[(List[Msg], Option[(Long, String)])] =
    for
      _ <- room(id)
      docs <- colls.msg
        .find(visible(id, me) ++ filter)
        .sort($doc("date" -> -1, "_id" -> -1))
        .cursor[Bdoc]()
        .list(51)
      page = docs.take(50)
      allowed <- media.visibleGroupMedia(page, me)
      rows = page.map(visibleMessage(_, me, allowed))
    yield rows -> Option.when(docs.size > 50)(rows.last.date.toEpochMilli -> rows.last.id)

  def mediaAllowed(id: String)(using me: Me): Fu[Boolean] =
    me.kid.no
      .so(room(id).flatMap(_ => contactApi.mediaUsers(List(me.userId)).map(_(me.userId))))
      .recover { case _: MsgActionError => false }

  def canReadAttachment(id: String, parent: String, author: UserId, handle: String)(using
      me: Me
  ): Fu[Boolean] =
    room(id)
      .flatMap(_ =>
        colls.msg.one[Bdoc](
          visible(id, me) ++ $id(parent) ++ $doc(
            "user" -> author,
            "attachments" -> handle,
            "deletedAt".$exists(false)
          )
        )
      )
      .flatMap(d => media.visibleGroupMedia(d.toList, me))
      .map(_.contains(parent))
      .recover { case _: MsgActionError => false }

  private def find(id: String, msgId: String)(using me: Me): Fu[Bdoc] =
    colls.msg.one[Bdoc](visible(id, me) ++ $id(msgId)).flatMap(_.fold(fail[Bdoc]("notFound"))(fuccess))

  def source(id: String, msgId: String)(using me: Me): Fu[Msg] =
    if id == GlobalChat.id || !MsgGroups.validId(id) then
      val tid = if id == GlobalChat.id then id else MsgThread.id(me, UserId(id)).value
      if id == GlobalChat.id && me.kid.yes then fail("notFound")
      else
        colls.msg
          .one[Msg]($id(msgId) ++ $doc("tid" -> tid, "del".$ne(me.userId), "deletedAt".$exists(false)))
          .flatMap(_.fold(fail[Msg]("notFound"))(fuccess))
    else
      for
        _ <- room(id)
        doc <- find(id, msgId)
        raw = message(doc, me)
        allowed <- media.visibleGroupMedia(List(doc), me)
        _ <- check(raw.deletedAt.isEmpty && (raw.attachments.isEmpty || allowed(raw.id)), "notFound")
      yield raw

  def send(
      id: String,
      text: String,
      nonce: String,
      reply: Option[String],
      items: List[String],
      forward: Option[(String, String)],
      cardJson: Option[String] = None
  )(using me: Me): Fu[Msg] =
    limit(me.userId, fail[Msg]("limited")):
      val msgId = s"${me.userId}_$nonce"
      val digest = lila.memo.Attachment.sha(
        Json
          .stringify(
            JsArray(
              Json.arr(text, reply, items, forward.map(_._1), forward.map(_._2)).value ++ cardJson.map(
                JsString.apply
              )
            )
          )
          .getBytes(java.nio.charset.StandardCharsets.UTF_8)
      )
      def existing = colls.msg
        .one[Bdoc](visible(id, me) ++ $id(msgId))
        .flatMap:
          case Some(d) if d.string("requestDigest").contains(digest) =>
            media.visibleGroupMedia(List(d), me).map(ok => Some(visibleMessage(d, me, ok)))
          case Some(_) => fail[Option[Msg]]("conflict")
          case None => fuccess(None)
      for
        g <- room(id)
        _ <- check(nonce.matches("[a-zA-Z0-9-]{16,64}"), "invalid")
        previous <- existing
        result <- previous
          .fold {
            for
              card <- MsgCard.decode(cardJson, text, items)
              _ <- check(forward.isEmpty || card.isEmpty, "invalid")
              forwarded <- forward.traverse((peer, mid) => source(peer, mid))
              _ <- check(forwarded.forall(_.canForward) && (forwarded.isEmpty || items.isEmpty), "invalid")
              handles <- forwarded.filter(_.attachments.nonEmpty) match
                case Some(src) if attachments.enabled("msg") => media.copy(me, forward.get._1, src, id, msgId)
                case Some(_) => fail[List[String]]("attachmentsUnavailable")
                case None => fuccess(items)
              body = forwarded.fold(text)(_.text)
              _ <- check(!lila.core.security.SubmissionPolicy.blocked(body), "unsafeLink")
              clean <- Msg.make(body, me, nowInstant, handles).fold(fail[Msg]("invalid"))(fuccess)
              quote <- reply.traverse(find(id, _))
              peers <- g.users.filterNot(_.is(me)).filterA(eligible(_, Some(body)))
              audience = me.userId :: peers
              _ <- check(
                peers.nonEmpty && quote
                  .forall(d => audience.forall(d.getAsOpt[List[UserId]]("audience").getOrElse(Nil).contains))
              )
              m = clean.copy(
                id = msgId,
                requestDigest = Some(digest),
                card = forwarded.flatMap(_.card).orElse(card),
                forwarded = forwarded.nonEmpty,
                reply = quote
                  .map(message(_, me))
                  .filter(_.deletedAt.isEmpty)
                  .map(m => Msg.Quote(m.id, m.user, m.text.take(1000)))
              )
              _ <- attachments.transaction: tx =>
                val rooms: Coll = tx.collection(colls.group.name)
                val messages: Coll = tx.collection(colls.msg.name)
                for
                  current <- rooms
                    .findAndUpdateSimplified[MsgGroup](
                      membership(id) ++ $doc("version" -> g.version),
                      $inc("serial" -> 1)
                    )
                    .flatMap(_.fold(fail[MsgGroup]("conflict"))(fuccess))
                  _ <- handles.nonEmpty.so:
                    for
                      _ <- check(attachments.enabled("msg"), "attachmentsUnavailable")
                      _ <- contactApi.guardMedia(tx, List(me.userId))
                      ok <- mediaAllowed(id)
                      _ <- check(ok, "privateTextOnly")
                      _ <- forward.zip(forwarded).so((from, src) => media.guardForward(tx, me, from._1, src))
                      _ <- attachments.prepare(me, s"msg/$id", msgId, 0L, handles, transaction = Some(tx))
                    yield ()
                  _ <- messages.insert.one(writeMsg(m, MsgThread.Id(id)) ++ $doc("audience" -> audience))
                  latestFor = audience
                    .filter(u => current.previews.get(u.value).forall(p => !p.date.isAfter(m.date)))
                  last = m.asLast
                  previews = latestFor.foldLeft($empty)((d, u) => d ++ $doc(s"previews.$u" -> last))
                  _ <- rooms.update.one(
                    $id(id),
                    $max("updatedAt" -> m.date) ++
                      latestFor.nonEmpty.so($set(previews) ++ $pull("hidden".$in(latestFor)))
                  )
                yield ()
              _ = emit(
                audience,
                "msgChanged",
                Json.obj("user" -> id, "msg" -> json.renderMsg(m), "kind" -> "new")
              )
              _ = peers.foreach(u => shutupApi.privateMessage(me, u, m.text))
              _ = notifier.onGroupPost(id, m, peers)
            yield m
          }(fuccess)
          .recoverWith(
            lila.db.recoverDuplicateKey(_ => existing.flatMap(_.fold(fail[Msg]("conflict"))(fuccess)))
          )
      yield result

  def typing(id: String, active: Boolean)(using me: Me): Funit =
    limit(me.userId, funit)(
      room(id)
        .flatMap(g => g.users.filterNot(_.is(me)).filterA(eligible(_, None)))
        .map(users =>
          emit(users, "msgTyping", Json.obj("user" -> id, "sender" -> me.userId, "active" -> active))
        )
    )

  def acknowledge(id: String, ids: List[String], read: Boolean)(using me: Me): Fu[JsObject] =
    limit(me.userId, fail[JsObject]("limited")):
      for
        _ <- room(id)
        _ <- check(ids.size <= 100, "invalid")
        selector = visible(id, me) ++ $inIds(ids) ++ $doc("user".$ne(me.userId), "deletedAt".$exists(false))
        now = nowInstant
        _ <- (if read then List("delivered", "reads") else List("delivered")).sequentiallyVoid: field =>
          val path = s"$field.${me.userId}"
          colls.msg.update.one(selector ++ $doc(path.$exists(false)), $set(path -> now), multi = true).void
        docs <- colls.msg.find(selector).cursor[Bdoc]().list(100)
        _ <- docs
          .groupBy(_.getAsTry[UserId]("user").get)
          .toList
          .sequentiallyVoid: (author, batch) =>
            val latest = batch.map(message(_, author)).maxBy(_.date)
            val path = s"previews.$author"
            val fields = latest.deliveredAt.so(t => $doc(s"$path.deliveredAt" -> t)) ++ latest.readAt
              .so(t => $doc(s"$path.readAt" -> t, s"$path.read" -> true))
            if fields.elements.isEmpty then funit
            else colls.group.update.one($id(id) ++ $doc(s"$path.id" -> latest.id), $set(fields)).void
        _ <- read.so:
          colls.group.update
            .one(
              membership(id) ++ $doc(s"previews.${me.userId}.id".$in(docs.flatMap(_.string("_id")))),
              $set(s"previews.${me.userId}.read" -> true)
            )
            .flatMap: r =>
              notifyApi.markRead(
                me.userId,
                $doc(
                  "content.thread" -> id
                ) ++ (if r.n > 0 then
                        $or($doc("content.messageId".$exists(false)), $doc("content.messageId".$in(ids)))
                      else $doc("content.messageId".$in(ids)))
              )
      yield
        docs
          .groupBy(_.getAsTry[UserId]("user").get)
          .foreach: (author, batch) =>
            emit(
              List(author),
              "msgReceipt",
              Json.obj("user" -> id, "receipts" -> batch.map(d => json.receipt(message(d, author))))
            )
        val payload = Json.obj("user" -> id, "receipts" -> docs.map(d => json.receipt(message(d, me))))
        emit(List(me.userId), "msgReceipt", payload)
        payload

  private def invitation(id: String, token: String)(using me: Me) =
    if me.kid.yes || !me.enabled.yes || me.isBot || me.marks.troll || !MsgGroups.validId(id) ||
      !token.matches("[0-9a-f-]{36}")
    then fail[MsgGroup]("notFound")
    else
      colls.group
        .one[MsgGroup](
          $id(id) ++ $doc("inviteToken" -> token, "blocked".$ne(me.userId), "removed".$ne(me.userId))
        )
        .flatMap(_.fold(fail[MsgGroup]("notFound"))(fuccess))

  def inviteName(id: String, token: String)(using Me) = invitation(id, token).map(_.name)

  def join(id: String, token: String)(using me: Me): Fu[Boolean] =
    limit(me.userId, fail[Boolean]("limited")):
      invitation(id, token).flatMap: g =>
        if g.users.contains(me.userId) then fuccess(true)
        else
          for
            _ <- check(g.users.size < maxMembers && g.admins.nonEmpty)
            blocked <- relationApi.filterBlocked(me.userId, g.admins)
            blocking <- relationApi.filterBlocking(g.admins, me.userId)
            _ <- check(blocked.isEmpty && blocking.isEmpty)
            _ <- check(!g.approval || g.requests.size < 100 || g.requests.contains(me.userId))
            update =
              if g.approval then $addToSet("requests" -> me.userId)
              else
                $addToSet("users" -> me.userId) ++ $set(
                  s"previews.${me.userId}" -> Msg.Last("", me, nowInstant, true)
                )
            result <- colls.group.update.one(
              $id(id) ++ $doc("version" -> g.version, "inviteToken" -> token),
              update ++ $inc("version" -> 1)
            )
            _ <- check(result.n == 1, "conflict")
          yield
            refresh(if g.approval then g.admins else me.userId :: g.users, id)
            !g.approval

  def manage(id: String, action: String, value: String, members: List[UserId])(using me: Me): Funit =
    limit(me.userId, fail[Unit]("limited")):
      room(id).flatMap: g =>
        val selector = membership(id) ++ $doc("version" -> g.version)
        def change(update: Bdoc, removed: List[UserId] = Nil, added: List[UserId] = Nil) =
          colls.group.update
            .one(
              selector ++ (if added.nonEmpty then
                             $doc("blocked".$nin(added)) ++
                               (if !g.admins.contains(me.userId) then $doc("removed".$nin(added)) else $empty)
                           else $empty),
              update ++ $inc("version" -> 1)
            )
            .flatMap: r =>
              check(r.n == 1, "conflict").map: _ =>
                refresh(g.users.diff(removed) ++ added, id)
                emit(removed, "msgThreadRemoved", Json.obj("user" -> id))
        action match
          case "rename"
              if g.admins.contains(
                me.userId
              ) && value.trim.nonEmpty && value.length <= 64 && !lila.core.security.SubmissionPolicy.blocked(
                value
              ) =>
            change($set("name" -> lila.common.String.softCleanUp(value).trim))
          case "describe"
              if g.admins.contains(me.userId) && value.length <= 480 && !lila.core.security.SubmissionPolicy
                .blocked(value) =>
            val description = lila.common.String.softCleanUp(value).trim
            change(if description.isEmpty then $unset("description") else $set("description" -> description))
          case "promote" | "demote" if g.admins.contains(me.userId) =>
            g.changeAdmin(UserId(value), action == "promote")
              .fold(fail[Unit]())(admins => change($set("admins" -> admins)))
          case "linkOn" | "linkReset" if g.admins.contains(me.userId) =>
            change(
              $set("inviteToken" -> java.util.UUID.randomUUID().toString, "requests" -> List.empty[UserId])
            )
          case "linkOff" if g.admins.contains(me.userId) =>
            change($unset("inviteToken", "requests"))
          case "approval" if g.admins.contains(me.userId) =>
            change($set("approval" -> (value == "true")))
          case "decline" if g.admins.contains(me.userId) =>
            change($pull("requests" -> UserId(value)))
          case "adminAddOnly" if g.admins.contains(me.userId) =>
            change($set("adminAddOnly" -> (value == "true")))
          case "add" | "approve" if g.admins.contains(me.userId) || (action == "add" && !g.adminAddOnly) =>
            val added = if action == "approve" then g.requests.filter(_ == UserId(value))
            else members.distinct.diff(g.users)
            val at = nowInstant
            val permitted = if action == "approve" then
              for
                active <- contactApi.adultIds(added)
                blocked <- relationApi.filterBlocked(me.userId, added)
                blocking <- relationApi.filterBlocking(added, me.userId)
                _ <- check(added.nonEmpty && added.forall(active) && blocked.isEmpty && blocking.isEmpty)
              yield ()
            else invitees(added)
            check(added.size + g.users.size <= maxMembers) >> permitted >>
              change(
                $set(
                  $doc("users" -> (g.users ++ added)) ++ added.foldLeft($empty)((d, u) =>
                    d ++ $doc(s"previews.$u" -> Msg.Last("", me, at, true))
                  )
                ) ++ $doc("$pull" -> $doc("requests".$in(added), "removed".$in(added))),
                added = added
              )
          case "leave" | "block" | "remove" =>
            val target = if action == "remove" then UserId(value) else me.userId
            val remaining = g.users.filterNot(_ == target)
            check(g.users.contains(target) && (target.is(me) || g.admins.contains(me.userId))) >>
              change(
                $set(
                  "users" -> remaining,
                  "admins" -> g.remainingAdmins(remaining)
                ) ++ (if action == "remove" then $addToSet("removed" -> target) else $empty) ++ $unset(
                  s"previews.$target"
                ) ++ (if action == "block" then $addToSet("blocked" -> me.userId)
                      else $empty),
                List(target)
              ) >>
              notifyApi.remove(target, $doc("content.thread" -> id))
          case "delete" =>
            attachments
              .transaction: tx =>
                val rooms: Coll = tx.collection(colls.group.name)
                val messages: Coll = tx.collection(colls.msg.name)
                rooms.update
                  .one(selector, $addToSet("hidden" -> me.userId))
                  .flatMap(r => check(r.n == 1, "conflict")) >>
                  messages.update.one(visible(id, me), $addToSet("del" -> me.userId), multi = true).void
              .flatMap(_ => notifyApi.remove(me.userId, $doc("content.thread" -> id)))
              .map(_ => emit(List(me.userId), "msgThreadRemoved", Json.obj("user" -> id)))
          case _ => fail()

  def update(
      id: String,
      msgId: String,
      action: String,
      value: String,
      revision: Int,
      replacement: Option[List[String]]
  )(using me: Me): Fu[Msg] =
    limit(me.userId, fail[Msg]("limited")):
      for
        g <- room(id)
        doc <- find(id, msgId)
        old = message(doc, me)
        _ <- check(old.revision == revision, "conflict")
        audience = doc.getAsOpt[List[UserId]]("audience").getOrElse(Nil).intersect(g.users)
        at = nowInstant
        next <- action match
          case "deleteMe" => fuccess(old)
          case "deleteEveryone"
              if old.canDeleteForEveryone(if g.admins.contains(me.userId) then old.user else me.userId, at) =>
            fuccess(old.copy(deletedAt = Some(at), pinnedAt = None))
          case "pin" if old.deletedAt.isEmpty =>
            fuccess(old.copy(pinnedAt = Option.when(value == "true")(at)))
          case "vote" | "endPoll" => MsgCard.pollAction(old, me, action, value)
          case "react" if old.deletedAt.isEmpty && MsgActions.validReaction(value) =>
            fuccess(
              old.copy(reactions =
                old.reactions.filterNot(_.user.is(me)) ++ value.nonEmpty.option(Msg.Reaction(me, value))
              )
            )
          case "edit" if old.canEdit(me, at) && !lila.core.security.SubmissionPolicy.blocked(value) =>
            val items = replacement.getOrElse(old.attachments)
            for
              clean <- Msg.make(value, me, at, items).fold(fail[Msg]("invalid"))(fuccess)
              allowed <- audience.filterNot(_.is(me)).traverse(eligible(_, Some(clean.text)))
              _ <- check(allowed.forall(identity))
            yield old.copy(
              text = clean.text,
              card = None,
              attachments = items,
              editedAt = Some(at),
              history = old.history :+ Msg.Version(old.text, old.editedAt.getOrElse(old.date))
            )
          case _ => fail[Msg]()
        saved = next.copy(revision = old.revision + 1)
        unpinned <- attachments.transaction: tx =>
          val rooms: Coll = tx.collection(colls.group.name)
          val msgs: Coll = tx.collection(colls.msg.name)
          for
            lock <- rooms.update.one(membership(id) ++ $doc("version" -> g.version), $inc("serial" -> 1))
            _ <- check(lock.n == 1, "conflict")
            _ <- (action == "edit" && saved.attachments.nonEmpty).so:
              mediaAllowed(id).flatMap(ok => check(ok, "privateTextOnly")) >> contactApi.guardMedia(
                tx,
                List(me.userId)
              ) >> attachments
                .prepare(
                  me,
                  s"msg/$id",
                  msgId,
                  saved.revision.toLong,
                  saved.attachments,
                  transaction = Some(tx)
                )
                .void
            ok <- MsgStore(msgs, rooms).saveVisible(visible(id, me), me, old, saved, action == "deleteMe")
            _ <- check(ok, "conflict")
            _ <-
              if action == "deleteMe" then
                msgs
                  .find(visible(id, me))
                  .sort($sort.desc("date"))
                  .one[Bdoc]
                  .flatMap: last =>
                    val change = last.fold($addToSet("hidden" -> me.userId))(d =>
                      $set(s"previews.${me.userId}" -> message(d, me).asLast)
                    )
                    rooms.update.one($id(id) ++ $doc(s"previews.${me.userId}.id" -> msgId), change).void
              else
                audience.sequentiallyVoid: u =>
                  rooms.update
                    .one(
                      $id(id) ++ $doc(s"previews.$u.id" -> msgId),
                      $set(
                        s"previews.$u.text" -> saved.asLast.text,
                        s"previews.$u.deleted" -> saved.deletedAt.nonEmpty
                      )
                    )
                    .void
            overflow <- (action == "pin" && value == "true").so:
              msgs
                .find($doc("tid" -> id, "pinnedAt".$exists(true)))
                .sort($sort.desc("pinnedAt"))
                .cursor[Bdoc]()
                .list(100)
                .map(_.drop(3))
            _ <- overflow.sequentiallyVoid: pinned =>
              msgs.update.one($id(pinned.string("_id").get), $unset("pinnedAt") ++ $inc("revision" -> 1)).void
          yield overflow
        _ <- (action == "edit" || action == "deleteEveryone").so(
          audience.sequentiallyVoid(u =>
            notifyApi.remove(
              u,
              $doc(
                "content.thread" -> id,
                "content.user" -> old.user,
                "content.text" -> lila.common.String.shorten(old.text, 40)
              )
            )
          )
        )
        activeRecipients <- contactApi.enabledIds(audience)
        recipients = audience.diff(doc.getAsOpt[List[UserId]]("del").getOrElse(Nil)).filter(activeRecipients)
        withMedia <-
          if saved.attachments.isEmpty || saved.deletedAt.nonEmpty then fuccess(Set.empty[UserId])
          else
            for
              blocked <- relationApi.filterBlocked(saved.user, recipients)
              blocking <- relationApi.filterBlocking(recipients, saved.user)
            yield recipients.toSet -- blocked -- blocking
      yield
        unpinned.foreach: record =>
          val recipients = media
            .audience(record)
            .intersect(g.users)
            .diff(record.getAsOpt[List[UserId]]("del").getOrElse(Nil))
          refresh(recipients, id)
        if action == "deleteMe" then
          emit(List(me.userId), "msgRemoved", Json.obj("user" -> id, "id" -> msgId))
        else
          recipients
            .groupBy(withMedia)
            .foreach: (ok, users) =>
              val shown = if ok then saved else saved.copy(attachments = Nil)
              emit(
                users,
                "msgChanged",
                Json.obj(
                  "user" -> id,
                  "kind" -> "update",
                  "msg" -> json.renderMsg(shown.copy(readAt = None, deliveredAt = None))
                )
              )
        if withMedia(me.userId) then saved else saved.copy(attachments = Nil)
