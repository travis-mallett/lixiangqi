package lila.msg

import play.api.libs.json.*
import lila.db.dsl.{ *, given }

final class MsgOrganization(colls: MsgColls)(using Executor, lila.core.config.RateLimit):
  private val coll = colls.organization
  private val limit = lila.memo.RateLimit[UserId](100, 1.minute, "msg.organize")
  private def key(user: UserId, chat: String) = s"$user/$chat"

  def muted(user: UserId, chat: String, mentioned: Boolean = false): Fu[Boolean] =
    coll.exists(
      $id(key(user, chat)) ++ $doc("mute" -> true) ++
        (if mentioned then $doc("mentions" -> false) else $empty)
    )

  def globalRecipients(mentions: Set[UserId]): Fu[Set[UserId]] =
    val chat = GlobalChat.id
    for
      subscribers <- colls.mailboxIndexes >> coll.distinctEasy[UserId, Set](
        "owner",
        $doc("chat" -> chat, "mute" -> false)
      )
      suppressed <- mentions.nonEmpty.so(
        coll.distinctEasy[UserId, Set](
          "owner",
          $inIds(mentions.toList.map(key(_, chat))) ++ $doc("mentions" -> false)
        )
      )
    yield subscribers ++ (mentions -- suppressed)

  def snapshot(using me: Me): Fu[JsObject] =
    colls.mailboxIndexes >> coll
      .list[Bdoc]($doc("owner" -> me.userId))
      .map: docs =>
        val states = docs.flatMap: d =>
          d.string("chat")
            .map: chat =>
              chat -> Json.obj(
                "archive" -> d.getAsOpt[Long]("archive"),
                "mute" -> d.getAsOpt[Boolean]("mute").getOrElse(chat == GlobalChat.id),
                "unread" -> d.getAsOpt[Boolean]("unread").contains(true),
                "pin" -> (chat == GlobalChat.id || d.getAsOpt[Boolean]("pin").contains(true)),
                "mentions" -> !d.getAsOpt[Boolean]("mentions").contains(false)
              )
        val folders = docs.flatMap: d =>
          d.string("folder")
            .map(id =>
              Json.obj(
                "id" -> id,
                "name" -> d.string("name"),
                "chats" -> d.getAsOpt[List[String]]("chats").getOrElse(Nil)
              )
            )
        val defaults = if me.kid.yes then Json.obj()
        else Json.obj(GlobalChat.id -> Json.obj("mute" -> true, "pin" -> true, "mentions" -> true))
        Json.obj("states" -> (defaults ++ JsObject(states)), "folders" -> folders)

  def selected(scope: String)(using me: Me): Fu[List[String]] =
    if scope.startsWith("folder/") then
      coll
        .one[Bdoc]($id(s"${me.userId}/$scope"))
        .map(_.flatMap(_.getAsOpt[List[String]]("chats")).getOrElse(Nil))
    else if Set("archive", "pin", "unread")(scope) then
      val selector = if scope == "archive" then $doc("archive".$exists(true)) else $doc(scope -> true)
      coll.distinctEasy[String, List]("chat", $doc("owner" -> me.userId) ++ selector)
    else fuccess(Nil)

  def update(chat: String, action: String, value: String, chats: List[String])(using me: Me): Fu[JsObject] =
    def fail = fufail[Unit](MsgActionError("invalid"))
    limit(me.userId, fufail[JsObject](MsgActionError("limited"))):
      val mutation = action match
        case "folder"
            if value.trim.nonEmpty && value.length <= 64 && chats.size <= 250 && chats.forall(validChat) =>
          val id = if chat.isEmpty then scalalib.ThreadLocalRandom.nextString(16) else chat
          if !id.matches("[a-zA-Z0-9]{16}") then fail
          else
            val selector = $id(s"${me.userId}/folder/$id") ++ $doc("owner" -> me.userId, "folder" -> id)
            coll.update
              .one(selector, $set("name" -> value.trim, "chats" -> chats.distinct), upsert = chat.isEmpty)
              .void
        case "deleteFolder" if chat.matches("[a-zA-Z0-9]{16}") =>
          coll.delete.one($id(s"${me.userId}/folder/$chat")).void
        case "archive" | "mute" | "pin" | "unread" | "mentions"
            if validChat(chat) && Set("true", "false")(value) =>
          val exists = if chat == GlobalChat.id then fuccess(me.kid.no && Set("mute", "mentions")(action))
          else if chat.startsWith("~") then colls.group.exists($id(chat) ++ $doc("users" -> me.userId))
          else colls.thread.exists($id(MsgThread.id(me, UserId(chat))))
          exists.flatMap:
            case false => fail
            case true =>
              val update = if action == "archive" && value == "true" then
                $set("archive" -> nowInstant.toEpochMilli)
              else if action == "mentions" || (chat == GlobalChat.id && action == "mute") || value == "true"
              then $set(action -> (value == "true"))
              else $unset(action)
              coll.update
                .one($id(key(me, chat)) ++ $doc("owner" -> me.userId, "chat" -> chat), update, upsert = true)
                .void
        case _ => fail
      mutation >> snapshot

  private def validChat(s: String) = s.nonEmpty && s.length <= 120 && !s.exists(c => c == '/' || c.isControl)
