package lila.msg

import reactivemongo.api.bson.*

import lila.db.BSON
import lila.db.dsl.{ *, given }

private object BsonHandlers:

  import Msg.Last
  given BSON[Last] with
    def reads(r: BSON.Reader) = Last(
      r.str("text"),
      r.get[UserId]("user"),
      r.date("date"),
      r.boolD("read"),
      r.strO("id"),
      r.boolD("deleted"),
      r.dateO("deliveredAt"),
      r.dateO("readAt")
    )
    def writes(w: BSON.Writer, m: Last) = $doc(
      "text" -> m.text,
      "user" -> m.user,
      "date" -> m.date,
      "read" -> m.read,
      "id" -> m.id,
      "deleted" -> m.deleted,
      "deliveredAt" -> m.deliveredAt,
      "readAt" -> m.readAt
    )

  given BSONDocumentHandler[Msg.Quote] = Macros.handler
  given BSONDocumentHandler[Msg.Version] = Macros.handler
  given BSONDocumentHandler[Msg.Reaction] = Macros.handler

  given BSONDocumentHandler[PollBallot] = Macros.handler
  given BSONDocumentHandler[MsgPoll] = Macros.handler
  given BSONDocumentHandler[MsgPreview] = Macros.handler
  given BSONDocumentHandler[MsgBoard.Shape] = Macros.handler
  given BSONDocumentHandler[MsgBoard.Capture] = Macros.handler
  given BSONDocumentHandler[MsgBoard.Frame] = Macros.handler
  given BSONDocumentHandler[MsgBoard] = Macros.handler
  given BSONDocumentHandler[MsgCard] = Macros.handler

  given threadHandler: BSON[MsgThread] with
    def reads(r: BSON.Reader) =
      r.strsD("users") match
        case List(u1, u2) =>
          MsgThread(
            id = r.get[MsgThread.Id]("_id"),
            user1 = UserId(u1),
            user2 = UserId(u2),
            lastMsg = r.get[Last]("lastMsg"),
            del = r.getO[List[UserId]]("del"),
            maskFor = r.getO[UserId]("maskFor"),
            maskWith = r.getO[Last]("maskWith"),
            preview = r.getD[Map[String, Last]]("preview", Map.empty)
          )
        case x => sys.error(s"Invalid MsgThread users: $x")
    def writes(w: BSON.Writer, t: MsgThread) =
      $doc(
        "_id" -> t.id,
        "users" -> t.users.sorted(using stringOrdering),
        "lastMsg" -> t.lastMsg,
        "maskFor" -> t.maskFor,
        "maskWith" -> t.maskWith
      )

  given msgHandler: BSON[Msg] with
    def reads(r: BSON.Reader) = Msg(
      text = r.str("text"),
      user = r.get[UserId]("user"),
      date = r.date("date"),
      id = r.str("_id"),
      reply = r.getO[Msg.Quote]("reply"),
      forwarded = r.boolD("forwarded"),
      history = r.getsD[Msg.Version]("history"),
      editedAt = r.dateO("editedAt"),
      deliveredAt = r.dateO("deliveredAt"),
      readAt = r.dateO("readAt"),
      deletedAt = r.dateO("deletedAt"),
      reactions = r.getsD[Msg.Reaction]("reactions"),
      pinnedAt = r.dateO("pinnedAt"),
      revision = r.intD("revision"),
      attachments = r.strsD("attachments"),
      requestDigest = r.strO("requestDigest"),
      card = r.getO[MsgCard]("card"),
      welcomeUser = r.getO[UserName]("welcomeUser")
    )
    def writes(w: BSON.Writer, m: Msg) = $doc(
      "_id" -> m.id,
      "text" -> m.text,
      "user" -> m.user,
      "date" -> m.date,
      "reply" -> m.reply,
      "forwarded" -> m.forwarded,
      "history" -> m.history,
      "editedAt" -> m.editedAt,
      "deliveredAt" -> m.deliveredAt,
      "readAt" -> m.readAt,
      "deletedAt" -> m.deletedAt,
      "reactions" -> m.reactions,
      "pinnedAt" -> m.pinnedAt,
      "attachments" -> m.attachments.nonEmptyOption,
      "requestDigest" -> m.requestDigest,
      "card" -> m.card,
      "welcomeUser" -> m.welcomeUser,
      "revision" -> m.revision
    )

  def writeMsg(msg: Msg, threadId: MsgThread.Id): Bdoc =
    msgHandler.writeTry(msg).get ++ $doc(
      "tid" -> threadId
    )

  def writeThread(thread: MsgThread, delBy: List[UserId]): Bdoc =
    threadHandler.writeTry(thread).get ++ $doc("del" -> delBy)
      ++ $doc("maskWith" -> $doc("date" -> thread.lastMsg.date))
  // looks weird, but maybe.. it is the way

  def selectNotDeleted(using me: Me) =
    if UserId.lichess.is(me) then $empty // using "del" is too expensive
    else $doc("del".$ne(me.userId))
