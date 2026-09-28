package lila.puzzle

import reactivemongo.pekkostream.cursorProducer

import lila.common.LilaStream
import lila.db.dsl.{ *, given }
import lila.mon.extensions.*
import lila.xiangqi.{ Xiangqi, XiangqiRules }

final private class PuzzleTagger(colls: PuzzleColls)(using
    ec: Executor,
    mat: org.apache.pekko.stream.Materializer
):
  import BsonHandlers.given

  private[puzzle] def addAllMissing: Funit =
    colls.puzzle:
      _.find($doc(Puzzle.BSONFields.tagMe -> true))
        .cursor[Puzzle]()
        .documentSource()
        .throttle(500, 1.second)
        .mapAsyncUnordered(2)(checkFirstTheme)
        .runWith(LilaStream.sinkCount)
        .chronometer
        .log(logger)(count => s"Done tagging $count puzzles")
        .result
        .void

  private def checkFirstTheme(puzzle: Puzzle): Funit = {
    for
      init <- puzzle.stateAfterInitialMove
      if !puzzle.hasTheme(PuzzleTheme.mateIn1)
      move <- puzzle.line.tail.headOption
      first <- XiangqiRules.move(Xiangqi.Position(initialFen = init.fen), move).toOption
    yield first.state.check
  }.exists(identity)
    .so:
      colls
        .round:
          _.update
            .one(
              $id(PuzzleRound.Id(UserId.lichess, puzzle.id).toString),
              $addToSet(PuzzleRound.BSONFields.themes -> PuzzleRound.Theme(PuzzleTheme.checkFirst.key, true))
            )
        .zip(colls.puzzle {
          _.update.one(
            $id(puzzle.id),
            $addToSet(
              Puzzle.BSONFields.themes -> PuzzleTheme.checkFirst.key,
              "communityThemes" -> PuzzleTheme.checkFirst.key
            )
          )
        })
        .void
    .flatMap(_ => colls.puzzle(_.update.one($id(puzzle.id), $unset(Puzzle.BSONFields.tagMe)).void))
