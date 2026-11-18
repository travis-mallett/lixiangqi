package lila.forum

import lila.core.security.SubmissionRejected
import lila.memo.{ Attachment, Attachments }
import lila.db.dsl.{ *, given }
import reactivemongo.api.DB

/** Only the four site discussion boards participate in the pilot. Team, diagnostic and blog discussions carry
  * their own visibility rules and remain text-only.
  */
final class ForumMedia(store: Attachments, access: ForumAccess, topics: ForumTopicRepo)(using Executor):
  def publicBoard(id: ForumCategId) = ForumCateg.publicBoards.exists(_.id == id)
  def audience(categ: ForumCategId, topic: Option[ForumTopicId]) =
    s"forum/$categ/${topic.fold("new")(_.value)}"

  def canStage(categ: ForumCategId, topic: Option[ForumTopicId])(using me: Me): Fu[Boolean] =
    (store.enabled("forum") && publicBoard(categ) && me.kid.no &&
      lila.core.security.canUploadImages("forumPostBody")).so:
      access.isGrantedWrite(categ)(using Some(me)) >>& topic.fold(fuTrue): tid =>
        topics.forUser(Some(me)).byId(tid).map(_.exists(t => t.categId == categ && t.open && !t.isOld))

  def commit[A](
      categ: ForumCategId,
      topic: Option[ForumTopicId],
      parent: ForumPostId,
      revision: Long,
      ids: List[String],
      retained: Set[String] = Set.empty
  )(write: Option[DB] => Fu[A])(using me: Me): Fu[A] =
    if ids.isEmpty then write(None)
    else
      store.transaction: tx =>
        canStage(categ, topic).flatMap:
          case false => fufail(SubmissionRejected("attachmentsUnavailable"))
          case true =>
            val rooms: Coll = tx.collection(topics.coll.name)
            for
              _ <- topic.so: tid =>
                rooms.update
                  .one($id(tid) ++ $doc("categId" -> categ, "closed".$ne(true)), $inc("mediaRevision" -> 1))
                  .flatMap { r =>
                    if r.n == 1 then funit else fufail(SubmissionRejected("attachmentsUnavailable"))
                  }
              _ <- store.prepare(me, audience(categ, topic), parent.value, revision, ids, retained, Some(tx))
              value <- write(Some(tx))
            yield value

  def records(coll: Coll, tx: Option[DB]): Coll = tx.fold(coll)(_.collection(coll.name))

  def postId(categ: ForumCategId, topic: Option[ForumTopicId], nonce: Option[String], fallback: ForumPostId)(
      using Me
  ) =
    nonce.fold(fallback)(n =>
      ForumPostId(Attachment.publicationId(summon[Me].userId, audience(categ, topic), n))
    )
