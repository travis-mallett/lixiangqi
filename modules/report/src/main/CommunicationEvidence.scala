package lila.report

import lila.core.config.CollName
import lila.db.dsl.{ *, given }
import reactivemongo.api.bson.{ BSONDocumentHandler, Macros }
import reactivemongo.api.bson.Macros.Annotations.Key

final case class EvidenceItem(
    suspect: UserId,
    resource: String,
    parent: String,
    revision: Long,
    text: String,
    attachments: List[String],
    privateItem: Boolean,
    status: String
)
final case class Evidence(@Key("_id") id: String, item: EvidenceItem, expiresAt: Instant)

final class CommunicationEvidence(db: lila.db.Db, attachments: lila.memo.Attachments)(using Executor):
  private val coll = db(CollName("ugc_evidence"))
  private lazy val expiryIndex =
    import reactivemongo.api.indexes.{ Index, IndexType }
    coll.indexesManager
      .ensure(Index(Seq("expiresAt" -> IndexType.Ascending), options = $doc("expireAfterSeconds" -> 0)))
      .void
  private given BSONDocumentHandler[EvidenceItem] = Macros.handler
  private given BSONDocumentHandler[Evidence] = Macros.handler
  def record(item: EvidenceItem): Fu[Evidence] =
    val hash = lila.memo.Attachment.sha(
      s"${item.resource}/${item.parent}/${item.revision}/${item.suspect}/${item.status}/${item.attachments.sorted.mkString(",")}"
        .getBytes(java.nio.charset.StandardCharsets.UTF_8)
    )
    val e = Evidence(hash, item, nowInstant.plusDays(30))
    val fields = summon[BSONDocumentHandler[Evidence]].writeTry(e).get
    expiryIndex >> coll.update.one($id(hash), $doc("$setOnInsert" -> fields), upsert = true) >>
      attachments.retainEvidence(item.attachments, e.expiresAt).inject(e)
  def get(id: String): Fu[Option[Evidence]] = coll.one[Evidence]($id(id) ++ $doc("expiresAt".$gt(nowInstant)))
