package lila.msg

import org.apache.pekko.actor.Cancellable

import lila.common.String.shorten
import lila.core.notify.{ NotifyApi, NotificationContent }
import lila.db.dsl.{ *, given }

final private class MsgNotify(
    colls: MsgColls,
    organization: MsgOrganization,
    contactApi: ContactApi,
    notifyApi: NotifyApi
)(using ec: Executor, scheduler: Scheduler):

  import BsonHandlers.given

  private val delay = 5.seconds

  private val delayed = scalalib.ConcurrentMap[MsgThread.Id, Cancellable](256)

  def onPost(threadId: MsgThread.Id): Unit = schedule(threadId)

  private val pendingGroups = scalalib.ConcurrentMap[(String, UserId, Boolean), Cancellable](256)

  def onGroupPost(id: String, message: Msg, recipients: List[UserId]): Unit =
    val mentions = MsgGroups.mentions(message.text)
    recipients.foreach: recipient =>
      val mentioned = mentions(recipient)
      val key = (id, recipient, mentioned)
      pendingGroups.compute(key): pending =>
        pending.foreach(_.cancel())
        scheduler
          .scheduleOnce(delay) {
            pendingGroups.remove(key)
            colls.group
              .one[Bdoc](
                $id(id) ++ $doc(
                  "users" -> recipient,
                  "hidden".$ne(recipient)
                )
              )
              .flatMapz: room =>
                colls.msg
                  .one[Msg](
                    $id(message.id) ++ $doc(
                      "tid" -> id,
                      "audience" -> recipient,
                      "del".$ne(recipient),
                      s"reads.$recipient".$exists(false),
                      "deletedAt".$exists(false)
                    )
                  )
                  .flatMapz: current =>
                    for
                      muted <- organization.muted(recipient, id, MsgGroups.mentions(current.text)(recipient))
                      latest = room
                        .child("previews")
                        .flatMap(_.child(recipient.value))
                        .flatMap(_.string("id"))
                        .contains(current.id)
                      mentionOverride <- (!muted && !latest && MsgGroups.mentions(current.text)(recipient))
                        .so(organization.muted(recipient, id))
                      adults <- (!muted && (latest || mentionOverride)).so(
                        contactApi.adultIds(List(current.user, recipient))
                      )
                      _ <- (adults.contains(current.user) && adults.contains(recipient)).so(
                        notifyApi.notifyOne(
                          recipient,
                          NotificationContent.PrivateMessage(
                            current.user,
                            shorten(current.text, 40),
                            Some(id),
                            room.string("name"),
                            Some(message.id)
                          )
                        )
                      )
                    yield ()
          }
          .some

  def onRead(userId: UserId, contactId: UserId): Funit =
    // Keep the pending check: it may now represent a newer unread message.
    notifyApi
      .markRead(
        userId,
        $doc(
          "content.type" -> "privateMessage",
          "content.user" -> contactId,
          "content.thread".$exists(false)
        )
      )
      .void

  def onContentChange(recipient: UserId, old: Msg): Funit =
    // Notifications contain only an excerpt, so use that exact excerpt to remove
    // stale copies without cancelling a newer message's pending notification.
    notifyApi.remove(
      recipient,
      $doc(
        "content.type" -> "privateMessage",
        "content.user" -> old.user,
        "content.thread".$exists(false),
        "content.text" -> shorten(old.text, 40)
      )
    )

  def deleteAllBy(threads: List[MsgThread], user: User): Funit =
    threads.sequentiallyVoid { thread =>
      cancel(thread.id)
      notifyApi.remove(thread.other(user.id), $doc("content.user" -> user.id)).void
    }

  private def schedule(threadId: MsgThread.Id): Unit = delayed.compute(threadId): canc =>
    canc.foreach(_.cancel())
    scheduler
      .scheduleOnce(delay):
        delayed.remove(threadId)
        doNotify(threadId)
      .some

  private def cancel(threadId: MsgThread.Id): Boolean =
    delayed.remove(threadId).map(_.cancel()).isDefined

  private def doNotify(threadId: MsgThread.Id): Funit =
    colls.thread.byId[MsgThread](threadId.value).flatMapz { thread =>
      val msg = thread.lastMsg
      (!msg.read && !msg.deleted && !thread.delBy(thread.other(msg.user))).so:
        val notification = NotificationContent.PrivateMessage(msg.user, text = shorten(msg.text, 40))
        val recipient = thread.other(msg.user)
        organization
          .muted(recipient, msg.user.value)
          .flatMap(muted => (!muted).so(notifyApi.notifyOne(recipient, notification)))
    }
