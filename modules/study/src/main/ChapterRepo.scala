package lila.study

import lila.xiangqi.XiangqiGlyph.{ Glyph, Glyphs }

import scala.collection.immutable.SeqMap
import org.apache.pekko.stream.scaladsl.*
import lila.xiangqi.UciPath
import lila.xiangqi.XiangqiJson.given
import chess.format.pgn.Tags
import lila.core.playerDirectory.PlayerId
import reactivemongo.pekkostream.cursorProducer
import reactivemongo.api.bson.*

import lila.db.AsyncColl
import lila.db.dsl.{ *, given }
import lila.tree.{ Branch, Branches, Clock }

import Node.BsonFields as F

final class ChapterRepo(val coll: AsyncColl, studyRepo: StudyRepo)(using
    Executor,
    org.apache.pekko.stream.Materializer
):

  import BSONHandlers.{ writeBranch, given }

  val $sortOrder = $sort.asc("order")
  val $sortOrderDesc = $sort.desc("order")

  def byId(id: StudyChapterId): Fu[Option[Chapter]] = coll(_.byId[Chapter](id))

  def studyIdOf(chapterId: StudyChapterId): Fu[Option[StudyId]] =
    coll(_.primitiveOne[StudyId]($id(chapterId), "studyId"))

  def deleteByStudy(s: Study): Funit =
    coll(_.delete.one($studyId(s.id))).void >> studyRepo.indexChapters(s.id)

  def deleteByStudyIds(ids: List[StudyId]): Funit = ids.nonEmpty.so:
    coll(_.delete.one($doc("studyId".$in(ids)))).void

  // studyId is useful to ensure that the chapter belongs to the study
  def byIdAndStudy(id: StudyChapterId, studyId: StudyId): Fu[Option[Chapter]] =
    coll(_.one($id(id) ++ $studyId(studyId)))

  def firstByStudy(studyId: StudyId): Fu[Option[Chapter]] =
    coll(_.find($studyId(studyId)).sort($sortOrder).one[Chapter])

  private[study] def lastByStudy(studyId: StudyId): Fu[Option[Chapter]] =
    coll(_.find($studyId(studyId)).sort($sortOrderDesc).one[Chapter])

  def existsByStudy(studyId: StudyId): Fu[Boolean] =
    coll(_.exists($studyId(studyId)))

  def orderedByStudySource(studyId: StudyId): Source[Chapter, ?] =
    Source.futureSource:
      coll.map:
        _.find($studyId(studyId))
          .sort($sortOrder)
          .cursor[Chapter]()
          .documentSource()

  def byIdsSource(ids: Iterable[StudyChapterId]): Source[Chapter, ?] =
    Source.futureSource:
      coll.map:
        _.find($inIds(ids))
          .cursor[Chapter]()
          .documentSource()

  def byStudiesSource(studyIds: Seq[StudyId]): Source[Chapter, ?] =
    Source.futureSource:
      coll.map:
        _.find($doc("studyId".$in(studyIds))).cursor[Chapter]().documentSource()

  // loads all study chapters in memory!
  def orderedByStudyLoadingAllInMemory(studyId: StudyId): Fu[List[Chapter]] =
    coll:
      _.find($studyId(studyId))
        .sort($sortOrder)
        .cursor[Chapter]()
        .list(ChapterRepo.maxChaptersToLoad + 1)
        .map: chapters =>
          require(chapters.size <= ChapterRepo.maxChaptersToLoad, "Study has too many chapters to load")
          chapters

  def idsByStudyWithServerEval(studyId: StudyId, withEval: Boolean): Fu[List[StudyChapterId]] =
    val selector = $doc("studyId" -> studyId, "serverEval" -> $exists(withEval))
    coll:
      _.distinctEasy[StudyChapterId, List]("_id", selector)

  def studyIdsByRelayPlayerId(playerId: lila.core.playerDirectory.PlayerId): Fu[List[StudyId]] =
    coll(_.distinctEasy[StudyId, List]("studyId", $doc("relay.playerIds" -> playerId)))

  def playerIdsOf(studyIds: List[StudyId]): Fu[Set[PlayerId]] =
    coll:
      _.aggregateOne(): framework =>
        import framework.*
        Match($doc("studyId".$in(studyIds), "relay.playerIds".$exists(true))) -> List(
          Project($doc("_id" -> false, "ids" -> "$relay.playerIds")),
          UnwindField("ids"),
          Group(BSONNull)("ids" -> AddFieldToSet("ids"))
        )
      .map:
        _.flatMap(_.getAsOpt[Set[PlayerId]]("ids")).orZero

  def sort(study: Study, ids: List[StudyChapterId]): Funit =
    coll: c =>
      ids
        .mapWithIndex: (id, index) =>
          c.updateField($studyId(study.id) ++ $id(id), "order", index + 1)
        .parallelVoid

  def nextOrderByStudy(studyId: StudyId): Fu[Chapter.Order] =
    coll(_.primitiveOne[Chapter.Order]($studyId(studyId), $sort.desc("order"), "order")).dmap { ~_ + 1 }

  def setConceal(chapterId: StudyChapterId, conceal: chess.Ply) =
    coll(_.updateField($id(chapterId), "conceal", conceal)).void

  def removeConceal(chapterId: StudyChapterId) =
    coll(_.unsetField($id(chapterId), "conceal")).void

  def setRelay(chapterId: StudyChapterId, relay: Chapter.Relay) =
    coll(_.updateField($id(chapterId), "relay", relay)).void

  def setRelayPath(chapterId: StudyChapterId, path: UciPath) =
    coll(_.updateField($id(chapterId) ++ $doc("relay.lastMoveAt".$exists(true)), "relay.path", path)).void

  def setTagsFor(chapter: Chapter) =
    coll(_.updateField($id(chapter.id), "tags", chapter.tags)).void >> studyRepo.indexChapters(
      chapter.studyId
    )

  def setShapes(shapes: lila.tree.Node.Shapes) =
    setNodeValue(F.shapes, shapes.value.nonEmpty.option(shapes))

  def setComments(comments: lila.tree.Node.Comments) =
    setNodeValue(F.comments, comments.value.nonEmpty.option(comments))

  def setGamebook(gamebook: lila.tree.Node.Gamebook) =
    setNodeValue(F.gamebook, gamebook.nonEmpty.option(gamebook))

  def setGlyphs(glyphs: Glyphs) = setNodeValue(F.glyphs, glyphs.nonEmpty)

  private[study] def setAnnotations(node: lila.tree.Node)(chapter: Chapter, path: UciPath): Funit =
    val values = $doc(
      F.comments -> node.comments,
      F.shapes -> node.shapes,
      F.glyphs -> node.glyphs,
      F.gamebook -> node.gamebook,
      F.score -> node.eval.flatMap(_.score),
      F.elapsed -> node.elapsed,
      F.evaluationDepth -> node.evaluationDepth,
      F.result -> node.result
    )
    val fields = values.elements.map(e => pathToField(path, e.name) -> e.value).toList
    coll(_.update.one($id(chapter.id) ++ $doc(path.toDbField.$exists(true)), $set($doc(fields)))).void

  def setClockAndDenorm(
      chapter: Chapter,
      path: UciPath,
      clock: Clock,
      denorm: Option[Chapter.BothClocks]
  ) =
    val updateNode = $doc(pathToField(path, F.clock) -> clock)
    val updateDenorm = denorm.map(clocks => $doc("denorm.clocks" -> clocks))
    coll:
      _.update
        .one(
          $id(chapter.id) ++ $doc(path.toDbField.$exists(true)),
          $set(updateDenorm.foldLeft(updateNode)(_ ++ _))
        )
        .void

  def forceVariation(force: Boolean)(chapter: Chapter, path: UciPath): Funit =
    coll(
      _.update.one(
        $id(chapter.id) ++ $doc(path.toDbField.$exists(true)),
        $set($doc(pathToField(path, F.forceVariation) -> force, "denorm" -> chapter.denorm))
      )
    ).void

  def setName(id: StudyChapterId, name: StudyChapterName) =
    coll(_.updateField($id(id), "name", name)).void >> studyIdOf(id).flatMap(_.so(studyRepo.indexChapters))

  // insert node and its children
  // and updates chapter denormalization
  private[study] def addSubTree(
      chapter: Chapter,
      subTree: Branch,
      parentPath: UciPath,
      relay: Option[Chapter.Relay]
  ): Funit =
    val parent =
      chapter.root.nodeAt(parentPath).getOrElse(throw IllegalArgumentException("Missing subtree parent"))
    val order = parent.children.addNode(subTree).toList.map(_.id)
    val set = $doc(subTreeToBsonElements(parentPath, subTree)) ++
      $doc(pathToField(parentPath, F.order) -> order) ++
      $doc("denorm" -> chapter.denorm) ++
      relay.flatMap(toBdoc).so(r => $doc("relay" -> r))
    coll(_.update.one($id(chapter.id), $set(set))).void

  private def subTreeToBsonElements(parentPath: UciPath, subTree: Branch): List[(String, Bdoc)] =
    require(parentPath.depth < Node.MAX_PLIES, "Study exceeds maximum path depth")
    locally:
      val path = parentPath + subTree.id
      subTree.children.toList
        .flatMap(subTreeToBsonElements(path, _))
        .appended:
          path.toDbField -> writeBranch(subTree)

  // overrides all children sub-nodes in DB! Make the tree merge beforehand.
  def setChildren(children: Branches)(chapter: Chapter, path: UciPath): Funit =
    val set: Bdoc = $doc(childrenTreeToBsonElements(path, children)) ++
      $doc(pathToField(path, F.order) -> children.toList.map(_.id))
    coll(_.update.one($id(chapter.id), $set(set))).void

  private def childrenTreeToBsonElements(
      parentPath: UciPath,
      children: Branches
  ): List[(String, Bdoc)] =
    require(children.isEmpty || parentPath.depth < Node.MAX_PLIES, "Study exceeds maximum path depth")
    locally:
      for
        node <- children.toList
        path = parentPath + node.id
        elems <- childrenTreeToBsonElements(path, node.children).appended(path.toDbField -> writeBranch(node))
      yield elems

  private def setNodeValue[A: BSONWriter](
      field: String,
      value: Option[A]
  )(chapter: Chapter, path: UciPath): Funit =
    coll:
      _.updateOrUnsetField(
        $id(chapter.id) ++ $doc(path.toDbField.$exists(true)),
        pathToField(path, field),
        value
      ).void

  private[study] def setNodeValues(
      chapter: Chapter,
      path: UciPath,
      values: List[(String, Option[BSONValue])]
  ): Funit =
    values.collect { case (field, Some(v)) =>
      pathToField(path, field) -> v
    } match
      case Nil => funit
      case sets =>
        coll:
          _.update
            .one(
              $id(chapter.id) ++ $doc(path.toDbField.$exists(true)),
              $set($doc(sets))
            )
            .void

  // root.path.subField
  private def pathToField(path: UciPath, subField: String): String = s"${path.toDbField}.$subField"

  private[study] def idNamesByStudyIds(
      studyIds: Seq[StudyId],
      nbChaptersPerStudy: Int
  ): Fu[Map[StudyId, Vector[Chapter.IdName]]] =
    studyIds.nonEmpty.so:
      coll:
        _.find(
          $doc("studyId".$in(studyIds)),
          $doc("studyId" -> true, "_id" -> true, "name" -> true).some
        )
          .sort($sortOrder)
          .cursor[Bdoc]()
          .list(nbChaptersPerStudy * studyIds.size)
      .map: docs =>
        docs.foldLeft(Map.empty[StudyId, Vector[Chapter.IdName]]): (hash, doc) =>
          doc.getAsOpt[StudyId]("studyId").fold(hash) { studyId =>
            hash.get(studyId) match
              case Some(chapters) if chapters.sizeIs >= nbChaptersPerStudy => hash
              case maybe =>
                val chapters = ~maybe
                hash + (studyId -> chapterIdNameHandler.readOpt(doc).fold(chapters)(chapters :+ _))
          }

  def idNames(studyId: StudyId): Fu[List[Chapter.IdName]] =
    coll:
      _.find($studyId(studyId), $doc("_id" -> true, "name" -> true).some)
        .sort($sortOrder)
        .cursor[Chapter.IdName]()
        .list(Study.maxChapters.value)

  // ordered like studyIds, then tags with the chapter order field
  // the Result tag is omitted when the game is unstarted
  def tagsByStudyIds(studyIds: Iterable[StudyId]): Fu[SeqMap[StudyId, SeqMap[StudyChapterId, Tags]]] =
    studyIds.nonEmpty.so:
      coll:
        _.find(
          $doc("studyId".$in(studyIds)),
          $doc("studyId" -> true, "tags" -> true, "denorm.uci" -> true).some
        )
          .sort($sortOrder)
          .cursor[Bdoc]()
          .listAll()
          .map: docs =>
            for
              doc <- docs
              chapterId <- doc.getAsOpt[StudyChapterId]("_id")
              studyId <- doc.getAsOpt[StudyId]("studyId")
              rawTags <- doc.getAsOpt[Tags]("tags")
              tags =
                if rawTags(_.Result).contains("*") && !doc.child("denorm").exists(_.contains("uci"))
                then rawTags - chess.format.pgn.Tag.Result
                else rawTags
            yield (studyId, chapterId, tags)
          .map:
            _.groupBy(_._1).view
              .mapValues:
                _.view
                  .map: (_, chapterId, tags) =>
                    chapterId -> tags
                  .to(SeqMap)
              .toMap
          .map: hash =>
            studyIds.view
              .map: id =>
                id -> ~hash.get(id)
              .to(SeqMap)

  def startServerEval(chapter: Chapter) =
    coll:
      _.updateField(
        $id(chapter.id),
        "serverEval",
        Chapter.ServerEval(
          path = chapter.root.mainlinePath,
          done = false
        )
      )
    .void

  def completeServerEval(chapter: Chapter) =
    coll(_.updateField($id(chapter.id) ++ "serverEval".$exists(true), "serverEval.done", true)).void

  def countByStudyId(studyId: StudyId): Fu[Int] =
    coll(_.countSel($studyId(studyId)))

  def insert(s: Chapter): Funit =
    coll(_.insert.one(s.updateDenorm)).void >> studyRepo.indexChapters(s.studyId)

  def update(c: Chapter): Funit =
    coll(_.update.one($id(c.id), c.updateDenorm)).void >> studyRepo.indexChapters(c.studyId)

  def delete(id: StudyChapterId): Funit =
    studyIdOf(id).flatMap: studyId =>
      coll(_.delete.one($id(id))).void >> studyId.so(studyRepo.indexChapters)
  def delete(c: Chapter): Funit = delete(c.id)

  def $studyId(id: StudyId) = $doc("studyId" -> id)

object ChapterRepo:
  // Broadcast studies can contain more chapters than the regular study editor.
  private[study] val maxChaptersToLoad = 256
