package lila.puzzle

import play.api.libs.json.*
import java.util.concurrent.atomic.AtomicBoolean
import reactivemongo.api.WriteConcern
import reactivemongo.api.indexes.{ Index, IndexType }
import lila.db.AsyncColl
import lila.db.dsl.{ *, given }

/** A durable, serialized authoring journal. Replaying it only CAS-writes authored fields. The database
  * control record serializes publishers across application processes; no lease can expire underneath a
  * worker. Every worker is safe to replay.
  */
final class PuzzlePublication(colls: PuzzleColls, journal: AsyncColl)(using Executor):
  import PuzzlePublicationJson.*
  private val running = AtomicBoolean(false)
  private val controlId = "control"
  private val durable = WriteConcern(WriteConcern.Majority, j = true, fsync = false, wtimeout = Some(10000))
  private val indexed = AtomicBoolean(false)
  private def indexes: Funit = if indexed.get then funit
  else
    colls
      .path(
        _.indexesManager.ensure(
          Index(
            Seq(
              "generation" -> IndexType.Ascending,
              "min" -> IndexType.Ascending,
              "max" -> IndexType.Ascending
            )
          )
        )
      )
      .flatMap: _ =>
        journal(
          _.indexesManager.ensure(
            Index(Seq("status" -> IndexType.Ascending, "createdAt" -> IndexType.Ascending))
          )
        ).void.addEffect(_ => indexed.set(true))

  def submit(request: JsValue, operator: UserId): Fu[JsObject] =
    val body = obj(request, Set("operationId", "digest", "changes"))
    val id = str(body, "operationId")
    check(id.matches("[a-zA-Z0-9-]{16,80}"), "Invalid operation ID")
    val changes = (body \ "changes").as[Vector[JsObject]]
    check(
      changes.nonEmpty && changes.size <= 100 && canonical(body)
        .getBytes(java.nio.charset.StandardCharsets.UTF_8)
        .length <= 4 * 1024 * 1024,
      "Batch limit: 100 changes / 4 MiB"
    )
    check(str(body, "digest") == digest(Json.obj("changes" -> changes)), "Operation digest mismatch")
    changes.foreach: c =>
      obj(c, Set("puzzle", "expectedDigest", "expectedRevision", "provenance"))
      puzzle((c \ "puzzle").get)
      Set("expectedDigest", "expectedRevision").foreach(k =>
        check(
          c.keys(k) && ((c \ k).get == JsNull || (c \ k).asOpt[String].exists(_.nonEmpty)),
          s"Missing precondition $k"
        )
      )
      val provenance = (c \ "provenance").as[JsObject]
      check(canonical(provenance).length <= 8192 && provenance.keys.nonEmpty, "Content provenance required")
      if (c \ "expectedDigest").get == JsNull then
        check(
          (provenance \ "status").asOpt[String].contains("verified") && (provenance \ "assessmentId").toOption
            .exists(_ != JsNull),
          "New puzzles require verification provenance"
        )
    check(
      changes.map(c => str((c \ "puzzle").get, "_id")).distinct.size == changes.size,
      "Duplicate puzzle ID"
    )
    check(
      changes.map(c => digest(identity((c \ "puzzle").as[JsObject]) - "_id")).distinct.size == changes.size,
      "Duplicate solve identity"
    )
    journal(
      _.update(writeConcern = durable).one(
        $id(id),
        $doc(
          "$setOnInsert" -> $doc(
            "request" -> canonical(body),
            "digest" -> str(body, "digest"),
            "operator" -> operator,
            "status" -> "submitted",
            "createdAt" -> nowInstant
          )
        ),
        upsert = true
      )
    ).flatMap: _ =>
      receipt(id).map: found =>
        val result = found.get
        check(str(result, "digest") == str(body, "digest"), "Operation ID already used for different content")
        tick()
        result

  def receipt(id: String): Fu[Option[JsObject]] = journal(_.byId[Bdoc](id)).map(_.map: d =>
    Json.obj(
      "operationId" -> id,
      "digest" -> d.string("digest"),
      "status" -> d.string("status"),
      "applied" -> d.int("applied").getOrElse(0),
      "error" -> d.string("error"),
      "request" -> d.string("request").map(Json.parse)
    ))

  private def inventoryVersion: Fu[String] = journal(_.byId[Bdoc](controlId)).map: control =>
    check(
      control.flatMap(_.string("operation")).isEmpty,
      "Publication in progress; retry inventory after completion"
    )
    control.flatMap(_.string("version")).getOrElse("bootstrap")

  def inventory(after: String, ids: List[String] = Nil): Fu[JsObject] =
    for
      _ <- Future {
        check(ids.size <= 100 && ids.forall(_.matches("[A-Za-z0-9]{5}")), "Invalid inventory IDs")
      }
      version <- inventoryVersion
      docs <- colls.puzzle(
        _.find(if ids.nonEmpty then $inIds(ids) else $doc("_id".$gt(after)))
          .sort($sort.asc("_id"))
          .cursor[Bdoc]()
          .collect[List](100, reactivemongo.api.Cursor.FailOnError[List[Bdoc]]())
      )
      current <- inventoryVersion
    yield
      check(version == current, "Publication changed during inventory read; retry")
      Json.obj(
        "version" -> version,
        "puzzles" -> docs.map(d =>
          Json.obj(
            "puzzle" -> authored(d),
            "digest" -> digest(authored(d)),
            "revision" -> d.string("authorRevision")
          )
        ),
        "next" -> (if ids.nonEmpty then None else docs.lastOption.flatMap(_.string("_id")))
      )

  def refreshPaths(): Funit =
    val id = "selection-" + (nowMillis / 3600000).toString
    val request = Json.obj("operationId" -> id, "changes" -> Json.arr())
    journal(
      _.update(writeConcern = durable).one(
        $id(id),
        $doc(
          "$setOnInsert" -> $doc(
            "request" -> canonical(request),
            "digest" -> digest(request),
            "status" -> "submitted",
            "createdAt" -> nowInstant
          )
        ),
        upsert = true
      )
    ).void.addEffect(_ => tick())

  def tick(): Unit = if running.compareAndSet(false, true) then
    recover()
      .recover { case e: Exception => logger.error("Puzzle publication recovery", e) }
      .onComplete(_ => running.set(false))

  private[puzzle] def recover(): Funit = indexes.flatMap(_ => recoverReady())

  private def recoverReady(): Funit =
    journal(
      _.update(writeConcern = durable).one(
        $id(controlId),
        $doc("$setOnInsert" -> $doc("operation" -> reactivemongo.api.bson.BSONNull)),
        upsert = true
      )
    ).flatMap: _ =>
      journal(_.byId[Bdoc](controlId)).flatMap: control =>
        control.flatMap(_.string("operation")) match
          case Some(id) => run(id)
          case None =>
            journal(_.find($doc("status" -> "submitted")).sort($sort.asc("createdAt")).one[Bdoc]).flatMapz:
              pending =>
                val id = pending.string("_id").get
                journal(
                  _.update(writeConcern = durable).one(
                    $id(controlId) ++ $doc("operation" -> reactivemongo.api.bson.BSONNull),
                    $set("operation" -> id)
                  )
                ).flatMap(r => if r.n > 0 then run(id) else funit)

  private def run(id: String): Funit =
    journal(_.byId[Bdoc](id)).flatMapz: record =>
      record.string("status").get match
        case "submitted" => prepare(id, Json.parse(record.string("request").get)).flatMap(_ => run(id))
        case "applying" =>
          val plan = Json.parse(record.string("plan").get).as[Vector[JsObject]]
          val work = plan.zipWithIndex.foldLeft(funit): (prev, item) =>
            prev
              .flatMap(_ => applyChange(id, item._1))
              .flatMap(_ =>
                journal(
                  _.update(writeConcern = durable)
                    .one($id(id), $doc("$max" -> $doc("applied" -> (item._2 + 1))))
                ).void
              )
          work
            .flatMap(_ => publishPaths(id, plan))
            .flatMap: _ =>
              journal(
                _.update(writeConcern = durable).one(
                  $id(id) ++ $doc("status" -> "applying"),
                  $set("status" -> "visible", "completedAt" -> nowInstant) ++ $unset("error")
                )
              ).void
            .flatMap(_ => release(id))
            .recoverWith { case e: Exception =>
              journal(
                _.update(writeConcern = durable)
                  .one($id(id) ++ $doc("status" -> "applying"), $set("error" -> e.getMessage.take(1000)))
              ).void
            }
        case "visible" | "conflict" => release(id)
        case _ => funit

  private def release(id: String): Funit = journal(
    _.update(writeConcern = durable)
      .one($id(controlId) ++ $doc("operation" -> id), $set("operation" -> reactivemongo.api.bson.BSONNull))
  ).void

  private def prepare(id: String, request: JsValue): Funit =
    val changes = (request \ "changes").as[Vector[JsObject]]
    changes.toList
      .traverse: change =>
        val p = puzzle((change \ "puzzle").get)
        colls
          .puzzle(_.byId[Bdoc](str(p, "_id")))
          .map: previous =>
            val before = previous.map(authored)
            check(
              (change \ "expectedDigest").get == before.fold[JsValue](JsNull)(p => JsString(digest(p))),
              s"Stale content: ${str(p, "_id")}"
            )
            check(
              (change \ "expectedRevision").get == previous
                .flatMap(_.string("authorRevision"))
                .fold[JsValue](JsNull)(JsString.apply),
              s"Stale revision: ${str(p, "_id")}"
            )
            before.foreach(b =>
              check(identity(b) == identity(p), s"Solve identity changed: ${str(p, "_id")}; use a new ID")
            )
            check(previous.isDefined || !(p \ "retired").as[Boolean], "Cannot add retired content")
            change ++ Json.obj("puzzle" -> p, "before" -> before)
      .flatMap: plan =>
        journal(
          _.update(writeConcern = durable).one(
            $id(id) ++ $doc("status" -> "submitted"),
            $set("status" -> "applying", "plan" -> canonical(Json.toJson(plan)))
          )
        ).void
      .recoverWith { case e: Invalid =>
        // A second recovery worker may have advanced the journal meanwhile.
        // Never reject an operation which has already started applying.
        journal(
          _.update(writeConcern = durable).one(
            $id(id) ++ $doc("status" -> "submitted"),
            $set("status" -> "conflict", "error" -> e.getMessage.take(1000))
          )
        ).void
      }

  private def applyChange(operation: String, change: JsObject, attempt: Int = 0): Funit =
    val p = (change \ "puzzle").as[JsObject]
    val id = str(p, "_id")
    colls
      .puzzle(_.byId[Bdoc](id))
      .flatMap:
        case Some(current) if current.string("authorRevision").contains(operation) =>
          check(authored(current) == p, s"Authored content drift: $id")
          funit
        case current =>
          check(
            current
              .flatMap(_.string("authorRevision"))
              .fold[JsValue](JsNull)(JsString.apply) == (change \ "expectedRevision").get,
            s"Revision conflict: $id"
          )
          check(
            current
              .map(d => digest(authored(d)))
              .fold[JsValue](JsNull)(JsString.apply) == (change \ "expectedDigest").get,
            s"Content conflict: $id"
          )
          val previousThemes = current.flatMap(_.getAsOpt[List[String]]("themes")).getOrElse(Nil)
          val previousManaged =
            current.flatMap(_.getAsOpt[List[String]]("managedThemes")).getOrElse(previousThemes)
          val community = current
            .flatMap(_.getAsOpt[List[String]]("communityThemes"))
            .getOrElse(previousThemes.diff(previousManaged))
          val managed = (p \ "themes").as[List[String]]
          val fields = document(p - "_id" - "themes") ++ $doc(
            "themes" -> (community ::: managed).distinct,
            "communityThemes" -> community,
            "managedThemes" -> managed,
            "managedBy" -> "lixiangqi-puzzle-catalog",
            "authorRevision" -> operation,
            "contentDigest" -> digest(p),
            "provenance" -> document((change \ "provenance").as[JsObject])
          )
          current match
            case None =>
              colls
                .puzzle(
                  _.insert(writeConcern = durable).one(
                    fields ++ $id(id) ++ $doc(
                      "glicko" -> $doc("r" -> 1500, "d" -> 350, "v" -> 0.09),
                      "plays" -> 0,
                      "vote" -> 1
                    )
                  )
                )
                .void
                .recoverWith:
                  case _: Exception if attempt < 10 => applyChange(operation, change, attempt + 1)
            case Some(_) =>
              // Compare the community projection as well: a concurrent tag write
              // must cause a reread, never disappear behind a stale merged array.
              val selector = $id(id) ++ $doc(
                "themes" -> previousThemes,
                "communityThemes" -> current
                  .flatMap(_.getAsOpt[reactivemongo.api.bson.BSONValue]("communityThemes"))
                  .getOrElse(reactivemongo.api.bson.BSONNull),
                "authorRevision" -> bson((change \ "expectedRevision").get)
              )
              colls
                .puzzle(_.update(writeConcern = durable).one(selector, $doc("$set" -> fields)))
                .flatMap: result =>
                  if result.n > 0 then funit
                  else if attempt < 100 then applyChange(operation, change, attempt + 1)
                  else fufail(s"Community activity prevented update of $id; retrying later")

  private def publishPaths(operation: String, plan: Vector[JsObject]): Funit =
    journal(_.byId[Bdoc](operation)).flatMap: receipt =>
      receipt.flatMap(_.getAsOpt[Bdoc]("pathGenerations")) match
        case Some(generations) => activatePaths(operation, generations)
        case None => buildPaths(operation, plan)

  private def activatePaths(operation: String, generations: Bdoc): Funit =
    val updates = $doc(generations.elements.map(e => s"generations.${e.name}" -> e.value))
    journal(
      _.update(writeConcern = durable).one(
        $id(controlId) ++ $doc("operation" -> operation),
        $doc("$set" -> (updates ++ $doc("version" -> operation)))
      )
    ).void
      .flatMap: _ =>
        journal(_.byId[Bdoc](controlId)).flatMapz: control =>
          val live =
            control.getAsOpt[Bdoc]("generations").toList.flatMap(_.elements.flatMap(_.value.asOpt[String]))
          colls
            .path(
              _.delete.one(
                $doc(
                  "gen".$lt(nowInstant.minusDays(2).toMillis),
                  "generation" -> $doc("$exists" -> true, "$nin" -> live)
                )
              )
            )
            .void

  private def buildPaths(operation: String, plan: Vector[JsObject]): Funit =
    val generation = operation + "-" + java.util.UUID.randomUUID().toString
    val affected = (Set("mix") ++ plan.flatMap(c =>
      List((c \ "puzzle").asOpt[JsObject], (c \ "before").asOpt[JsObject]).flatten.flatMap(p =>
        (p \ "themes").as[List[String]]
      )
    )).toList.sorted
    // Only a compact runtime projection is read, never source games or histories.
    colls
      .puzzle(
        _.find(Puzzle.activeSelector, $doc("_id" -> true, "themes" -> true, "glicko.r" -> true).some)
          .cursor[Bdoc]()
          .collect[List](Int.MaxValue, reactivemongo.api.Cursor.FailOnError[List[Bdoc]]())
      )
      .flatMap: active =>
        val rows = active.map(d =>
          (
            d.string("_id").get,
            d.getAsOpt[Bdoc]("glicko").flatMap(_.getAsOpt[Double]("r")).getOrElse(1500d),
            d.getAsOpt[List[String]]("themes").getOrElse(Nil)
          )
        )
        val angles = if plan.isEmpty then (affected ++ rows.flatMap(_._3)).distinct.sorted else affected
        val paths = angles.flatMap: angle =>
          val ids = rows.filter(r => Puzzle.eligibleForAngle(r._3, angle)).sortBy(r => (r._2, r._1))
          ids
            .grouped(24)
            .zipWithIndex
            .toList
            .flatMap: (chunk, index) =>
              def boundary(a: Double, b: Double) = math.round((a + b) / 2).toInt.max(0).min(9999)
              val lower = if index == 0 then 0 else boundary(ids(index * 24 - 1)._2, chunk.head._2)
              val end = index * 24 + chunk.size
              val upper = if end == ids.size then 9999 else boundary(chunk.last._2, ids(end)._2)
              List("all", "good", "top").map: tier =>
                $doc(
                  "_id" -> s"$angle|$tier|$generation|$index",
                  "generation" -> generation,
                  "min" -> f"$angle|$tier|$lower%04d",
                  "max" -> f"$angle|$tier|$upper%04d",
                  "ids" -> chunk.map(_._1),
                  "gen" -> nowMillis
                )
        paths
          .foldLeft(funit)((prev, path) =>
            prev
              .flatMap(_ =>
                colls.path(
                  _.update(writeConcern = durable)
                    .one($id(path.string("_id").get), $doc("$setOnInsert" -> path), upsert = true)
                )
              )
              .void
          )
          .flatMap: _ =>
            val generations = $doc(angles.map(a => a -> reactivemongo.api.bson.BSONString(generation)))
            // Competing or interrupted workers stage separate immutable generations.
            // Only the first complete build becomes the durable activation plan.
            journal(
              _.update(writeConcern = durable).one(
                $id(operation) ++ $doc("status" -> "applying", "pathGenerations".$exists(false)),
                $set("pathGenerations" -> generations)
              )
            ).flatMap(_ => publishPaths(operation, plan))
