package lila.msg

import lila.db.dsl.{ *, given }

/** Atomic message persistence; participant selectors are mandatory at this boundary. */
private[msg] final class MsgStore(msgs: Coll, threads: Coll)(using Executor):
  import BsonHandlers.given

  def visible(me: UserId, contact: UserId): Bdoc =
    $doc("tid" -> MsgThread.id(me, contact), "del".$ne(me))

  def canReadAttachment(viewer: UserId, author: UserId, recipient: UserId, parent: String, handle: String)(
      allowed: => Fu[Boolean]
  ): Fu[Boolean] =
    (viewer == author || viewer == recipient).so:
      val peer = if viewer == author then recipient else author
      allowed >>& msgs.exists(
        visible(viewer, peer) ++ $id(parent) ++ $doc(
          "user" -> author,
          "attachments" -> handle,
          "deletedAt".$exists(false)
        )
      )

  def save(me: UserId, contact: UserId, old: Msg, next: Msg, hide: Boolean): Fu[Boolean] =
    saveVisible(visible(me, contact), me, old, next, hide)

  def saveVisible(selector: Bdoc, me: UserId, old: Msg, next: Msg, hide: Boolean): Fu[Boolean] =
    msgs.update
      .one(
        selector ++ $id(old.id) ++ (if old.revision == 0 then
                                      $or($doc("revision" -> 0), $doc("revision".$exists(false)))
                                    else $doc("revision" -> old.revision)),
        if hide then $addToSet("del" -> me)
        else
          $set(
            $doc(
              "text" -> next.text,
              "history" -> next.history,
              "card" -> next.card,
              "attachments" -> next.attachments,
              "reactions" -> next.reactions,
              "revision" -> next.revision,
              "editedAt" -> next.editedAt,
              "deletedAt" -> next.deletedAt,
              "pinnedAt" -> next.pinnedAt
            )
          ) ++ {
            val unset = $doc(
              "pinnedAt" -> next.pinnedAt.isEmpty.option(1),
              "card" -> (old.card.nonEmpty && next.card.isEmpty).option(1)
            )
            if unset.isEmpty then $empty else $doc("$unset" -> unset)
          }
      )
      .map(_.nModified > 0)

  def acknowledge(me: UserId, contact: UserId, ids: List[String], read: Boolean, at: Instant): Fu[List[Msg]] =
    val selector = visible(me, contact) ++ $inIds(ids) ++ $doc("user" -> contact, "deletedAt".$exists(false))
    for
      _ <- msgs.update.one(
        selector ++ $doc("deliveredAt".$exists(false)),
        $set("deliveredAt" -> at),
        multi = true
      )
      _ <-
        if read then
          msgs.update.one(selector ++ $doc("readAt".$exists(false)), $set("readAt" -> at), multi = true).void
        else funit
      saved <- msgs.find(selector).cursor[Msg]().list(100)
      _ <- saved
        .maxByOption(_.date)
        .so: last =>
          threads.update
            .one(
              $id(MsgThread.id(me, contact)) ++ $doc("lastMsg.id" -> last.id),
              $set(
                $doc("lastMsg.deliveredAt" -> last.deliveredAt) ++ last.readAt
                  .so(at => $doc("lastMsg.readAt" -> at))
              )
            )
            .void
    yield saved

  def markThreadRead(me: UserId, contact: UserId, messages: List[Msg]): Fu[Boolean] =
    if messages.isEmpty then fuFalse
    else
      def mark(field: String) = threads.update
        .one(
          $id(MsgThread.id(me, contact)) ++ $doc(s"$field.user" -> contact) ++
            $or(
              $doc(s"$field.id".$in(messages.map(_.id))),
              $doc(s"$field.id".$exists(false), s"$field.date".$in(messages.map(_.date)))
            ),
          $set(s"$field.read" -> true)
        )
        .map(_.nModified > 0)
      for
        last <- mark("lastMsg")
        _ <- mark(s"preview.$me")
      yield last
