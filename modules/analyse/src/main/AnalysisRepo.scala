package lila.analyse

import lila.db.dsl.{ *, given }
import lila.tree.Analysis
import reactivemongo.api.bson.*

final class AnalysisRepo(val coll: Coll)(using Executor):

  import AnalyseBsonHandlers.given

  def byId(id: Analysis.Id): Fu[Option[Analysis]] = coll.secondary.byId[Analysis](id)

  def byGame(game: Game): Fu[Option[Analysis]] =
    game.metadata.analysed.so(byId(Analysis.Id(game.id)))

  def byIds(ids: Seq[Analysis.Id]): Fu[Seq[Option[Analysis]]] =
    coll.optionsByOrderedIds[Analysis, Analysis.Id](ids, readPref = _.sec)(_.id)

  def associateToGames(games: List[Game]): Fu[List[(Game, Analysis)]] =
    byIds(games.map(g => Analysis.Id(g.id))).map: as =>
      games.zip(as).collect { case (game, Some(analysis)) =>
        game -> analysis
      }

  def byHash(workHash: Array[Byte]): Fu[Option[Analysis]] =
    coll.one[Analysis]($doc("hash" -> workHash))

  private[analyse] def save(analysis: Analysis, workHash: Option[Array[Byte]]): Funit =
    val bson = toBdoc(analysis).get ++ workHash.so(h => $doc("hash" -> h))
    // Compare exact source history before depth. An older worker cannot replace
    // analysis requested for a later chapter revision, even with a deeper search.
    val source = bson.getAsTry[BSONDocument]("position").get
    val shallower =
      $doc("position" -> source) ++ $or("depth".$exists(false), "depth".$lt(analysis.depth.getOrElse(0)))
    val eligible = analysis.depth.fold($doc("_id".$exists(false)))(_ => shallower)
    val selector =
      $id(analysis.id) ++ (if analysis.studyId.isDefined then
                             $or(eligible, $doc("position".$ne(source), "date".$lt(analysis.date)))
                           else eligible)
    coll.update.one(selector, bson, upsert = true).void.recoverWith {
      case error: reactivemongo.api.commands.WriteResult if lila.db.isDuplicateKey(error) =>
        current(analysis.id).flatMap:
          case Some(existing) if !analysis.supersedes(existing) =>
            funit
          // Two first publications can both attempt insertion. If the shallower
          // one won, retry the conditional update against the now-existing ID.
          case _ => save(analysis, workHash)
    }

  def current(id: Analysis.Id): Fu[Option[Analysis]] = coll.byId[Analysis](id)

  def depths(ids: List[Analysis.Id]): Fu[Map[String, Option[Int]]] =
    coll
      .find($inIds(ids), $doc("depth" -> true).some)
      .cursor[Bdoc]()
      .collect[List](ids.size, reactivemongo.api.Cursor.FailOnError[List[Bdoc]]())
      .map(_.flatMap(d => d.string("_id").map(_ -> d.int("depth"))).toMap)

  def remove(id: GameId) = coll.delete.one($id(Analysis.Id(id)))

  def removeChapters(ids: Seq[StudyChapterId]) =
    coll.delete.one($doc("chapterId".$in(ids), "studyId".$exists(true)))
  def setOrphans(id: Seq[StudyChapterId]) =
    coll.updateField($doc("chapterId".$in(id), "studyId".$exists(true)), "orphan", true)

  def remove(ids: List[GameId]) = coll.delete.one($inIds(ids.map(Analysis.Id(_))))

  def exists(id: GameId) = coll.exists($id(Analysis.Id(id)))
  def chapterExists(id: StudyChapterId) = coll.exists($doc("chapterId" -> id, "studyId".$exists(true)))
