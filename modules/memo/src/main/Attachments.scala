package lila.memo

import java.security.MessageDigest
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8

import lila.core.security.SubmissionRejected
import lila.db.dsl.{ *, given }
import reactivemongo.api.bson.{ BSONBinary, BSONDocumentHandler, Macros }
import reactivemongo.api.bson.Macros.Annotations.Key

/** Bytes never enter Picfit's publicly addressable namespace. Parent records, not attachment IDs, authorize
  * publication. The worker changes the bytes exactly once, before the ready transition.
  */
final case class Attachment(
    @Key("_id") id: String,
    owner: UserId,
    audience: String,
    name: String,
    size: Int,
    state: String,
    policy: String,
    digest: Option[String],
    mime: Option[String],
    parent: Option[String],
    revision: Option[Long],
    review: Option[String] = None,
    reason: Option[String] = None
)
object Attachment:
  val policy = "ugc-1"
  val hardMaxBytes = 4 * 1024 * 1024
  def validId(id: String): Boolean = id.matches("[0-9a-f]{32}")
  def sha(bytes: Array[Byte]): String =
    java.util.HexFormat.of.formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
  def publicationId(owner: UserId, audience: String, nonce: String): String =
    if !nonce.matches("[a-zA-Z0-9-]{16,64}") then throw SubmissionRejected("invalid")
    sha(s"$owner/$audience/$nonce".getBytes(UTF_8)).take(32)

  def safeName(name: String): String =
    name.split("[/\\\\]").lastOption.getOrElse("").replaceAll("[^\\p{L}\\p{N} ._()-]", "_").take(96).trim

  given BSONDocumentHandler[Attachment] = Macros.handler

final class Attachments(db: lila.db.Db, config: play.api.Configuration)(using Executor):
  import Attachment.given
  private val coll = db(lila.core.config.CollName("ugc_attachment"))
  private val health = db(lila.core.config.CollName("ugc_scanner"))
  private val metadata = $doc("bytes" -> false)
  val maxBytes = config.get[Int]("attachments.maxBytes").max(1).min(Attachment.hardMaxBytes)
  private val defaultMaxCount = config.get[Int]("attachments.maxCount").max(1).min(8)
  private val inboxMaxCount =
    config.getOptional[Int]("attachments.inboxMaxCount").getOrElse(defaultMaxCount).max(1).min(8)
  def maxCount(surface: String): Int = if surface == "msg" then inboxMaxCount else defaultMaxCount
  val hourlyUploads = config.get[Int]("attachments.hourlyUploads").max(1)
  def enabled(surface: String): Boolean =
    Set("forum", "msg")(surface) && config.get[Boolean](s"attachments.$surface")

  def available: Fu[Boolean] = health.exists(
    $id("worker") ++ $doc(
      "policy" -> Attachment.policy,
      "healthy" -> true,
      "at".$gt(nowInstant.minusSeconds(90))
    )
  )

  def scannerStatus: Fu[(String, Int)] =
    val count = coll.countSel($doc("state" -> "checking"))
    if !enabled("msg") && !enabled("forum") then count.map("disabled" -> _)
    else
      health
        .one[Bdoc]($id("worker"))
        .zip(count)
        .map: (beat, pending) =>
          val fresh = beat.filter(_.getAsOpt[Instant]("at").exists(_.isAfter(nowInstant.minusSeconds(90))))
          fresh.flatMap(_.getAsOpt[String]("status")).getOrElse("offline") -> pending

  def reportRestricted(notify: (UserId, String) => Funit): Funit =
    coll
      .find($doc("urgent" -> true, "state" -> "restricted"), $doc("_id" -> true, "owner" -> true).some)
      .cursor[Bdoc]()
      .list(10)
      .flatMap:
        _.sequentiallyVoid: doc =>
          (doc.getAsOpt[String]("_id"), doc.getAsOpt[UserId]("owner")) match
            case (Some(id), Some(owner)) =>
              notify(owner, id) >> coll.update.one($id(id), $unset("urgent")).void
            case _ => funit

  def stage(owner: UserId, audience: String, filename: String, bytes: Array[Byte]): Fu[Attachment] =
    val name = Attachment.safeName(filename)
    val allowedName = name.nonEmpty && name != "." && name != ".." &&
      (audience.startsWith("msg/") || name
        .toLowerCase(java.util.Locale.ROOT)
        .matches(".+\\.(jpg|jpeg|png|webp|txt|pgn)"))
    if bytes.isEmpty || bytes.length > maxBytes || !allowedName then
      return fufail(SubmissionRejected("unsupportedFile"))
    val id = UUID.randomUUID().toString.replace("-", "")
    val item = Attachment(
      id,
      owner,
      audience,
      name,
      bytes.length,
      "checking",
      Attachment.policy,
      None,
      None,
      None,
      None
    )
    available.flatMap:
      case false => fufail(SubmissionRejected("scannerUnavailable"))
      case true =>
        coll.insert
          .one(
            summon[BSONDocumentHandler[Attachment]].writeTry(item).get ++ $doc(
              "sourceDigest" -> Attachment.sha(bytes),
              "bytes" -> BSONBinary(bytes, reactivemongo.api.bson.Subtype.GenericBinarySubtype),
              "createdAt" -> nowInstant,
              "nextCheck" -> nowInstant,
              "expiresAt" -> nowInstant.plusDays(1)
            )
          )
          .inject(item)

  /** Sessions are confined to attachment commits. Bytes, parent revisions and publication become visible
    * together.
    */
  def transaction[A](write: reactivemongo.api.DB => Fu[A]): Fu[A] = transactionAttempt(write, 3)

  private def transactionAttempt[A](write: reactivemongo.api.DB => Fu[A], attempts: Int): Fu[A] =
    coll.db
      .startSession()
      .flatMap: session =>
        val work = session
          .startTransaction(
            Some(
              reactivemongo.api.WriteConcern(
                reactivemongo.api.WriteConcern.Majority,
                j = true,
                fsync = false,
                wtimeout = Some(10000)
              )
            )
          )
          .flatMap: tx =>
            write(tx).flatMap(value => tx.commitTransaction().inject(value))
        work.transformWith:
          case scala.util.Success(value) => session.endSession().inject(value)
          case scala.util.Failure(error) =>
            session
              .abortTransaction()
              .recover { case _ => session }
              .flatMap(_.endSession())
              .flatMap { _ =>
                error match
                  case e: reactivemongo.core.errors.DatabaseException
                      if e.code.contains(112) && attempts > 1 =>
                    transactionAttempt(write, attempts - 1)
                  case e: reactivemongo.core.errors.DatabaseException if e.code.contains(112) =>
                    fufail(SubmissionRejected("conflict"))
                  case _ => fufail(error)
              }

  def get(id: String): Fu[Option[Attachment]] =
    coll.find($id(id), metadata.some).one[Attachment]

  def owned(id: String, owner: UserId, audience: String): Fu[Option[Attachment]] =
    coll.find($id(id) ++ $doc("owner" -> owner, "audience" -> audience), metadata.some).one[Attachment]

  def remove(id: String, owner: UserId, audience: String) =
    coll.delete
      .one(
        $id(id) ++ $doc(
          "owner" -> owner,
          "audience" -> audience,
          "parent".$exists(false),
          "hold".$ne(true),
          "review".$ne("requested")
        )
      )
      .void

  def retry(id: String, owner: UserId, audience: String) =
    coll.update
      .one(
        $id(id) ++ $doc("owner" -> owner, "audience" -> audience, "state" -> "retry", "hold".$ne(true)),
        $set("state" -> "checking", "nextCheck" -> nowInstant)
      )
      .map(_.nModified == 1)

  /** A failed association has no reader. The worker reconciles abandoned reservations against the parent
    * before deleting bytes. Repeating the same nonce can complete the same reservation.
    */
  def prepare(
      owner: UserId,
      audience: String,
      parent: String,
      revision: Long,
      ids: List[String],
      retained: Set[String] = Set.empty,
      transaction: Option[reactivemongo.api.DB] = None
  ): Funit =
    val surface = audience.takeWhile(_ != '/')
    if ids.isEmpty then funit
    else if !enabled(surface) || ids.size > maxCount(surface) || ids.distinct != ids || !ids
        .forall(Attachment.validId)
    then fufail(SubmissionRejected("attachmentsUnavailable"))
    else
      val records: Coll = transaction.fold(coll)(_.collection(coll.name))
      val sel = $inIds(ids) ++ $doc(
        "owner" -> owner,
        "state" -> "ready",
        "policy" -> Attachment.policy,
        "digest".$exists(true)
      )
      records
        .find(sel, metadata.some)
        .cursor[Attachment]()
        .list(ids.size)
        .flatMap: items =>
          val permitted = items.size == ids.size && items.forall { item =>
            (item.audience == audience || (retained(item.id) && item.parent.contains(parent))) && item.parent
              .forall(_ == parent)
          }
          if !permitted then fufail(SubmissionRejected("attachmentsUnavailable"))
          else
            items.sequentiallyVoid: item =>
              evidenceBytes(item, review = false, records = records).flatMap:
                case None => fufail(SubmissionRejected("attachmentsUnavailable"))
                case Some(_) =>
                  val claim = $id(item.id) ++ $doc(
                    "digest" -> item.digest,
                    "policy" -> Attachment.policy,
                    "state" -> "ready"
                  ) ++
                    $or($doc("parent".$exists(false)), $doc("parent" -> parent))
                  records.update
                    .one(
                      claim,
                      $set("parent" -> parent, "revision" -> revision, "expiresAt" -> nowInstant.plusDays(2))
                    )
                    .flatMap: r =>
                      if r.n == 1 then funit else fufail(SubmissionRejected("attachmentsUnavailable"))

  /** Forward an approved snapshot under a new owner/audience. Each copy has its own authorization. */
  def forward(from: Attachment, owner: UserId, audience: String, parent: String): Fu[String] =
    val id = Attachment.publicationId(owner, s"$audience/$parent", from.id)
    coll
      .one[Bdoc](
        $id(from.id) ++ $doc("state" -> "ready", "policy" -> Attachment.policy, "digest" -> from.digest)
      )
      .flatMap:
        case None => fufail(SubmissionRejected("attachmentsUnavailable"))
        case Some(src) =>
          val retained = reactivemongo.api.bson.BSONDocument(
            src.elements
              .filter(e =>
                Set(
                  "name",
                  "size",
                  "state",
                  "policy",
                  "digest",
                  "sourceDigest",
                  "mime",
                  "detectors",
                  "bytes"
                )(e.name)
              )
              .map(e => e.name -> e.value)
              .toList
          )
          coll.update
            .one(
              $id(id),
              $doc(
                "$setOnInsert" -> (retained ++ $doc(
                  "owner" -> owner,
                  "audience" -> audience,
                  "createdAt" -> nowInstant,
                  "expiresAt" -> nowInstant.plusDays(1)
                ))
              ),
              upsert = true
            )
            .inject(id)

  def requestReview(id: String, owner: UserId, audience: String): Fu[Option[String]] =
    val sel = $id(id) ++ $doc(
      "owner" -> owner,
      "audience" -> audience,
      "state" -> "blocked",
      "reason" -> "imagePolicy",
      "review".$ne("resolved")
    )
    coll
      .find(sel, metadata.some)
      .one[Attachment]
      .flatMapz: item =>
        coll.update
          .one(
            sel ++ $doc("digest" -> item.digest),
            $set("review" -> "requested", "expiresAt" -> nowInstant.plusDays(30))
          )
          .map(r => item.digest.filter(_ => r.n == 1))

  def resolveReview(id: String, digest: String, mod: UserId, approve: Boolean): Fu[Boolean] =
    val state = if approve then "ready" else "blocked"
    coll.update
      .one(
        $id(id) ++ $doc(
          "digest" -> digest,
          "policy" -> Attachment.policy,
          "state" -> "blocked",
          "reason" -> "imagePolicy",
          "review" -> "requested"
        ),
        $set("state" -> state, "review" -> "resolved", "reviewedBy" -> mod, "reviewedAt" -> nowInstant)
      )
      .map(_.nModified == 1)

  def retainEvidence(ids: List[String], until: Instant): Funit =
    ids.nonEmpty.so(
      coll.update
        .one(
          $inIds(ids) ++ $doc("state" -> "ready"),
          $doc("$max" -> $doc("evidenceUntil" -> until, "expiresAt" -> until)),
          multi = true
        )
        .void
    )

  def privateContacts(user: UserId): Fu[Set[UserId]] =
    val peers = coll.distinctEasy[String, Set](
      "audience",
      $doc("owner" -> user, "audience".$regex("^msg/", ""))
    )
    val owners = coll.distinctEasy[UserId, Set]("owner", $doc("audience" -> s"msg/$user"))
    peers.zip(owners).map((p, o) => o ++ p.map(a => UserId(a.drop(4))) + user)

  def approvedBytes(item: Attachment): Fu[Option[Array[Byte]]] = evidenceBytes(item, review = false)

  def evidenceBytes(item: Attachment, review: Boolean, records: Coll = coll): Fu[Option[Array[Byte]]] =
    val state = if review then $doc("state" -> "blocked", "reason" -> "imagePolicy", "review" -> "requested")
    else $doc("state" -> "ready")
    records
      .find(
        $id(item.id) ++ state ++ $doc("policy" -> Attachment.policy, "digest" -> item.digest),
        $doc("bytes" -> true).some
      )
      .one[Bdoc]
      .map:
        _.flatMap(_.getAsOpt[BSONBinary]("bytes"))
          .map(_.byteArray)
          .filter(b => item.digest.contains(Attachment.sha(b)))
