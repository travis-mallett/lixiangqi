package lila.msg

import lila.db.dsl.{ *, given }

private[msg] object GroupMessages:
  import BsonHandlers.{ *, given }

  def visible(id: String, user: UserId) = $doc("tid" -> id, "audience" -> user, "del".$ne(user))

  def message(doc: Bdoc, viewer: UserId): Msg =
    val m = msgHandler.read(doc)
    val peers = doc.getAsOpt[List[UserId]]("audience").getOrElse(Nil).filterNot(_ == m.user)
    def receipt(key: String) =
      val dates = doc.getAsOpt[Map[String, Instant]](key).getOrElse(Map.empty)
      if viewer != m.user then dates.get(viewer.value)
      else
        Option.when(peers.nonEmpty && peers.forall(p => dates.contains(p.value)))(
          peers.map(p => dates(p.value)).max
        )
    m.copy(deliveredAt = receipt("delivered"), readAt = receipt("reads"))
