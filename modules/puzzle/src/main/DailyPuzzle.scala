package lila.puzzle

import lila.db.dsl.{ *, given }
import lila.memo.CacheApi.*

import Puzzle.BSONFields as F
import lila.core.misc.puzzle.DailyChange

final private[puzzle] class DailyPuzzle(
    colls: PuzzleColls,
    pathApi: PuzzlePathApi,
    cacheApi: lila.memo.CacheApi
)(using Executor, Scheduler):

  import BsonHandlers.given

  private val cache =
    cacheApi.unit[Option[DailyPuzzle.WithHtml]]("puzzle.daily"):
      _.expireAfterWrite(1.minutes).buildAsyncTimeoutZero()(_ => find)

  def get: Fu[Option[DailyPuzzle.WithHtml]] = cache.getUnit.flatMap:
    case Some(daily) =>
      colls
        .puzzle(_.exists($id(daily.puzzle.id) ++ Puzzle.activeSelector))
        .flatMap:
          case true => fuccess(daily.some)
          case false =>
            cache.invalidateUnit()
            find
    case None => fuccess(none)

  private def find: Fu[Option[DailyPuzzle.WithHtml]] =
    findCurrent
      .orElse(findNew)
      .recover { case e: Exception =>
        logger.error("find daily", e)
        none
      }
      .flatMapz(makeDaily)

  private def makeDaily(puzzle: Puzzle): Fu[Option[DailyPuzzle.WithHtml]] = {
    lila.common.Bus
      .ask[Html, DailyPuzzle.Render]:
        DailyPuzzle.Render(puzzle, puzzle.fenAfterInitialMove, puzzle.line.head.value, _)
      .map: html =>
        DailyPuzzle.WithHtml(puzzle, html).some
  }.recover { case e: Exception =>
    logger.warn("make daily", e)
    none
  }

  private def findCurrent = colls.puzzle:
    _.find(Puzzle.activeSelector ++ $doc(F.day.$gt(nowInstant.minusDays(1))))
      .sort($sort.desc(F.day))
      .one[Puzzle]

  // Published paths already certify playable puzzles. Do not require thousands
  // of solves or a narrow rating band on a young server. Prefer unused puzzles,
  // but allow the oldest daily puzzles to return as the pool is exhausted.
  private def findNew: Fu[Option[Puzzle]] =
    pathApi
      .generation(PuzzleAngle.mix)
      .flatMap: generationSelector =>
        colls
          .path:
            _.aggregateOne(): framework =>
              import framework.*
              Match(
                pathApi.select(PuzzleAngle.mix, PuzzleTier.all, 0 to 9999) ++ generationSelector
              ) -> List(
                Sample(3),
                Project($doc("ids" -> true, "_id" -> false)),
                UnwindField("ids"),
                PipelineOperator:
                  $lookup.simple(
                    from = colls.puzzle.name,
                    as = "puzzle",
                    local = "ids",
                    foreign = "_id",
                    pipe = List(
                      $doc(
                        "$match" -> (Puzzle.activeSelector ++ $doc(
                          Puzzle.BSONFields.issue.$exists(false)
                        ))
                      )
                    )
                  )
                ,
                UnwindField("puzzle"),
                ReplaceRootField("puzzle"),
                Sort(Ascending(F.day), Descending(F.vote)),
                Limit(1)
              )
          .flatMap:
            _.flatMap(puzzleReader.readOpt).so { puzzle =>
              colls
                .puzzle(_.updateField($id(puzzle.id), F.day, nowInstant))
                .inject(puzzle.some)
                .addEffect(_ => lila.common.Bus.pub(DailyChange(puzzle.id)))
            }

object DailyPuzzle:
  type Try = () => Fu[Option[DailyPuzzle.WithHtml]]

  case class WithHtml(puzzle: Puzzle, html: Html)

  case class Render(puzzle: Puzzle, fen: String, lastMove: String, promise: Promise[Html])
