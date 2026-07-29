package lila.insight

import reactivemongo.api.bson.*

import lila.db.AsyncColl
import lila.db.dsl.{ *, given }
import lila.rating.BSONHandlers.perfTypeIdHandler
import lila.rating.PerfType

final private class InsightStorage(val coll: AsyncColl)(using Executor):

  import InsightStorage.*
  import BSONHandlers.given
  import InsightEntry.BSONFields as F

  def fetchFirst(userId: UserId): Fu[Option[InsightEntry]] =
    coll(_.find(selectUserId(userId)).sort(sortChronological).one[InsightEntry])

  def fetchLast(userId: UserId): Fu[Option[InsightEntry]] =
    coll(_.find(selectUserId(userId)).sort(sortAntiChronological).one[InsightEntry])

  def count(userId: UserId): Fu[Int] =
    coll(_.countSel(selectUserId(userId)))

  def insert(p: InsightEntry) = update(p)

  def bulkInsert(ps: Seq[InsightEntry]) =
    coll: collection =>
      val update = collection.update(ordered = false)
      for
        elements <- ps.toList.sequentially: entry =>
          update.element(
            q = selectId(entry.id),
            u = bsonWriteDoc(entry),
            upsert = true
          )
        _ <- elements.nonEmpty.so(update.many(elements).void)
      yield ()

  def update(p: InsightEntry) = coll(_.update.one(selectId(p.id), p, upsert = true).void)

  def removeAll(userId: UserId) = coll(_.delete.one($doc(F.userId -> userId)).void)

  def find(id: String) = coll(_.one[InsightEntry](selectCurrentId(id)))

  def nbByPerf(userId: UserId): Fu[Map[PerfType, Int]] =
    coll:
      _.aggregateList(lila.rating.PerfType.nonPuzzle.size) { framework =>
        import framework.*
        Match(selectUserId(userId)) -> List(
          GroupField(F.perf)("nb" -> SumAll)
        )
      }.map:
        _.flatMap { doc =>
          for
            perfType <- doc.getAsOpt[PerfType]("_id")
            nb <- doc.int("nb")
          yield perfType -> nb
        }.toMap

object InsightStorage:

  import InsightEntry.BSONFields as F

  def selectId(id: String) = $doc(F.id -> id)
  def selectCurrentId(id: String) = selectId(id) ++ $doc(F.version -> InsightEntry.schemaVersion)
  def selectUserId(id: UserId) =
    $doc(F.userId -> id, F.version -> InsightEntry.schemaVersion)
  def selectPeers(peers: PeersRatingRange) =
    $doc(F.rating.$inRange(peers.value), F.version -> InsightEntry.schemaVersion)
  val sortChronological = $sort.asc(F.date)
  val sortAntiChronological = $sort.desc(F.date)

  def gameMatcher(filters: List[Filter[?]]) = combineDocs(filters.collect {
    case f if f.dimension.isInGame => f.matcher
  })

  def combineDocs(docs: List[BSONDocument]) =
    docs.foldLeft(BSONDocument()): (acc, doc) =>
      acc ++ doc
