package lila.msg

import play.api.libs.json.*

import lila.common.Json.given
import lila.core.LightUser
import lila.core.relation.Relations

final class MsgJson(
    lightUserApi: lila.core.user.LightUserApi,
    isOnline: lila.core.socket.IsOnline
)(using Executor):

  private given lastMsgWrites: OWrites[Msg.Last] = Json.writes
  private given relationsWrites: OWrites[Relations] = Json.writes
  private given modDetailsWrites: OWrites[ContactDetailsForMods] = Json.writes
  private given OWrites[Msg.Quote] = Json.writes
  private given OWrites[Msg.Version] = Json.writes
  private given OWrites[Msg.Reaction] = Json.writes

  def threadsJson(threads: List[MsgThread])(using me: Me): Fu[JsArray] =
    withContacts(threads).map: threads =>
      JsArray(threads.map(renderThread))

  def contacts(threads: List[MsgThread])(using me: Me): Fu[JsObject] =
    threadsJson(threads).map: threads =>
      Json.obj("contacts" -> threads)

  def convo(c: MsgConvo): JsObject =
    Json
      .obj(
        "user" -> renderContact(c.contact),
        "msgs" -> c.msgs.map(renderMsg),
        "pinned" -> c.pinned.map(renderMsg),
        "relations" -> c.relations,
        "postable" -> c.postable
      )
      .add("modDetails" -> c.contactDetailsForMods)

  def renderMsg(msg: Msg): JsObject =
    Json.obj(
      "id" -> msg.id,
      "text" -> (if msg.deletedAt.isDefined then "" else msg.text),
      "user" -> msg.user,
      "date" -> msg.date,
      "revision" -> msg.revision,
      "deliveredAt" -> msg.deliveredAt,
      "readAt" -> msg.readAt,
      "deleted" -> msg.deletedAt.isDefined,
      "deletedAt" -> msg.deletedAt,
      "welcomeUser" -> msg.welcomeUser.filter(_ => msg.deletedAt.isEmpty),
      "card" -> msg.card.filter(_ => msg.deletedAt.isEmpty),
      "attachments" -> msg.attachments.filter(_ => msg.deletedAt.isEmpty),
      "reply" -> msg.reply.filter(_ => msg.deletedAt.isEmpty),
      "forwarded" -> msg.forwarded,
      "editedAt" -> msg.editedAt,
      "history" -> msg.history.filter(_ => msg.deletedAt.isEmpty),
      "reactions" -> msg.reactions.filter(_ => msg.deletedAt.isEmpty),
      "pinnedAt" -> msg.pinnedAt.filter(_ => msg.deletedAt.isEmpty),
      "canEditUntil" -> msg.canEdit(msg.user, nowInstant).option(msg.date.plusSeconds(24 * 3600)),
      "canDeleteUntil" -> msg
        .canDeleteForEveryone(msg.user, nowInstant)
        .option(msg.date.plusSeconds(24 * 3600))
    )

  def receipt(msg: Msg): JsObject =
    Json.obj("id" -> msg.id, "deliveredAt" -> msg.deliveredAt, "readAt" -> msg.readAt)

  def searchResult(res: MsgSearch.Result)(using me: Me): Fu[JsObject] =
    withContacts(res.threads).map: threads =>
      Json.obj(
        "contacts" -> threads.map(renderThread),
        "friends" -> res.friends,
        "users" -> res.users
      )

  private def withContacts(threads: List[MsgThread])(using me: Me): Fu[List[MsgThread.WithContact]] =
    lightUserApi
      .asyncMany(threads.map(_.other))
      .map: users =>
        threads
          .zip(users)
          .map: (thread, userOption) =>
            MsgThread.WithContact(thread, userOption | LightUser.fallback(thread.other.into(UserName)))

  private def renderThread(t: MsgThread.WithContact)(using me: Option[Me]) =
    Json.obj(
      "user" -> renderContact(t.contact),
      "lastMsg" -> me.fold(t.thread.lastMsg): me =>
        t.thread.preview.getOrElse(
          me.userId.value,
          if t.thread.maskFor.contains(me) then t.thread.maskWith.getOrElse(t.thread.lastMsg)
          else t.thread.lastMsg
        )
    )

  private def renderContact(user: LightUser): JsObject =
    lila.common.Json.lightUser
      .writeNoId(user)
      .add("online" -> isOnline.exec(user.id))
