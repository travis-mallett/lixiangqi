package lila.msg

import lila.core.security.SubmissionRejected
import lila.db.dsl.{ *, given }

/** Media policy and publication fences shared by direct messages and groups. */
private final class MsgMedia(
    colls: MsgColls,
    contacts: ContactApi,
    security: MsgSecurity,
    relation: lila.core.relation.RelationApi,
    attachments: lila.memo.Attachments
)(using Executor):
  def direct(author: UserId, recipient: UserId): Fu[Boolean] =
    contacts
      .contacts(author, recipient)
      .flatMap:
        case Some(pair) if pair.activeAdults && !pair.any(c => c.isTroll || c.isAlt) =>
          colls.thread
            .exists($id(MsgThread.id(author, recipient)))
            .flatMap(exists => security.may.post(pair, isNew = !exists))
        case _ => fuFalse

  def requireDirect(author: UserId, recipient: UserId): Funit =
    direct(author, recipient).flatMap(ok =>
      if ok then funit else fufail(SubmissionRejected("privateTextOnly"))
    )

  def audience(doc: Bdoc): List[UserId] = doc.getAsOpt[List[UserId]]("audience").getOrElse(Nil)

  /** Apply current blocks and the original audience once per page. Kid status limits group uploads. */
  def visibleGroupMedia(docs: List[Bdoc], viewer: UserId): Fu[Set[String]] =
    val withMedia = docs.filter(_.getAsOpt[List[String]]("attachments").exists(_.nonEmpty))
    if withMedia.isEmpty then fuccess(Set.empty[String])
    else
      val authors = withMedia.flatMap(_.getAsOpt[UserId]("user")).distinct
      for
        blocked <- relation.filterBlocked(viewer, authors)
        blocking <- relation.filterBlocking(authors, viewer)
      yield withMedia
        .filter { d =>
          val ids = audience(d)
          ids.contains(viewer) && d.getAsOpt[UserId]("user").exists(a => !blocked(a) && !blocking(a))
        }
        .flatMap(_.string("_id"))
        .toSet

  private def access(actor: UserId, chat: String, source: Msg): Fu[(String, List[UserId])] =
    val doc =
      $id(source.id) ++ $doc("del".$ne(actor), "deletedAt".$exists(false), "revision" -> source.revision)
    if chat == GlobalChat.id then
      for
        adults <- contacts.adultIds(List(actor))
        exists <- colls.msg.exists(
          doc ++ $doc("tid" -> chat, "user" -> source.user, "attachments" -> source.attachments)
        )
        _ <-
          if adults(actor) && exists then funit
          else fufail[Unit](SubmissionRejected("attachmentsUnavailable"))
      yield chat -> List(actor)
    else if MsgGroups.validId(chat) then
      for
        member <- colls.group.exists($id(chat) ++ $doc("users" -> actor))
        record <- colls.msg.one[Bdoc](doc ++ $doc("tid" -> chat, "audience" -> actor))
        visible <- visibleGroupMedia(record.toList, actor)
        _ <-
          if member && visible(source.id) then funit else fufail(SubmissionRejected("attachmentsUnavailable"))
      yield chat -> List(actor)
    else
      val peer = UserId(chat)
      val recipient = source.recipient(actor, peer)
      requireDirect(source.user, recipient).inject(recipient.value -> List(actor, peer))

  def copy(actor: UserId, from: String, source: Msg, to: String, newId: String): Fu[List[String]] =
    access(actor, from, source).flatMap: (recipient, _) =>
      source.attachments.traverse: handle =>
        attachments
          .get(handle)
          .flatMap:
            case Some(item)
                if item.parent.contains(
                  source.id
                ) && item.owner == source.user && item.audience == s"msg/$recipient" =>
              attachments.forward(item, actor, s"msg/$to", newId)
            case _ => fufail(SubmissionRejected("attachmentsUnavailable"))

  def guardForward(tx: reactivemongo.api.DB, actor: UserId, from: String, source: Msg): Funit =
    val messages: Coll = tx.collection(colls.msg.name)
    val rooms: Coll = tx.collection(colls.group.name)
    val isGroup = MsgGroups.validId(from)
    val tid = if isGroup then from else MsgThread.id(actor, UserId(from)).value
    def requireMatch(ok: Boolean) = if ok then funit else fufail[Unit](SubmissionRejected("conflict"))
    for
      pair <- access(actor, from, source)
      _ <- contacts.guardMedia(tx, pair._2)
      _ <- (isGroup && from != GlobalChat.id).so(
        rooms.update
          .one($id(from) ++ $doc("users" -> actor), $inc("serial" -> 1))
          .flatMap(r => requireMatch(r.n == 1))
      )
      result <- messages.update.one(
        $id(source.id) ++ $doc(
          "tid" -> tid,
          "revision" -> source.revision,
          "attachments" -> source.attachments,
          "del".$ne(actor),
          "deletedAt".$exists(false)
        ) ++
          (if isGroup && from != GlobalChat.id then $doc("audience" -> actor) else $empty),
        $inc("mediaForwardRevision" -> 1)
      )
      _ <- requireMatch(result.n == 1)
    yield ()
