package lila.insight

import chess.{ Centis, Clock, Ply, Stats }
import chess.eval.WinPercent

import lila.analyse.{ AccuracyCP, AccuracyPercent, Advice }
import lila.game.Blurs.booleans
import lila.xiangqi.Xiangqi

case class RichPov(
    pov: Pov,
    provisional: Boolean,
    analysis: Option[lila.analyse.Analysis],
    boards: NonEmptyList[Xiangqi.Board],
    clock: Option[Clock.Config],
    movetimes: Option[Vector[Centis]],
    clockStates: Option[Vector[Centis]],
    advices: Map[Ply, Advice]
):
  lazy val division = Xiangqi.phaseDivision(boards.toList.toVector)

final private class PovToEntry(
    gameRepo: lila.game.GameRepo,
    gameApi: lila.core.game.GameApi,
    analysisRepo: lila.analyse.AnalysisRepo
)(using Executor):

  def apply(game: Game, userId: UserId, provisional: Boolean): Fu[Either[Game, InsightEntry]] =
    enrich(game, userId, provisional).map(_.flatMap(convert).toRight(game))

  private def removeWrongAnalysis(game: Game): Boolean =
    if game.metadata.analysed && !gameApi.analysable(game) then
      gameRepo.setAnalysed(game.id, false)
      analysisRepo.remove(game.id)
      true
    else false

  private def enrich(game: Game, userId: UserId, provisional: Boolean): Fu[Option[RichPov]] =
    if removeWrongAnalysis(game) then fuccess(none)
    else
      Pov(game, userId).so: pov =>
        game.metadata.analysed
          .so(analysisRepo.byGame(game))
          .map: analysis =>
            game.xiangqi.states
              .traverse(state => Xiangqi.Fen.board(state.fen))
              .flatMap(_.toList.toNel)
              .map: boards =>
                RichPov(
                  pov = pov,
                  provisional = provisional,
                  analysis = analysis,
                  boards = boards,
                  clock = game.clock.map(_.config),
                  movetimes = game.clock
                    .flatMap(_ => lila.game.GameExt.computeMoveTimes(game, pov.color))
                    .map(_.toVector),
                  clockStates = game.clockHistory.map(_(pov.color)),
                  advices = analysis.so(_.advices.mapBy(_.info.ply))
                )

  private def makeMoves(from: RichPov): Option[List[InsightMove]] =
    val sideAndStart = from.pov.sideAndStart
    def cpDiffs = from.analysis.so { AccuracyCP.diffsList(sideAndStart, _).toVector }
    val accuracyPercents = from.analysis.map:
      AccuracyPercent.fromAnalysisAndPov(sideAndStart, _).toVector
    val prevInfos = from.analysis.so { an =>
      AccuracyCP.prevColorInfos(sideAndStart, an).pipe { is =>
        from.pov.color.fold(is, is.map(_.invert))
      }
    }
    val side = if from.pov.color.white then Xiangqi.Side.Red else Xiangqi.Side.Black
    val moveContexts = from.pov.game.xiangqi.moves
      .zip(from.pov.game.xiangqi.states.zip(from.boards.toList))
      .collect:
        case (move, (state, board)) if state.turn == side =>
          board
            .pieceAt(move.orig)
            .collect:
              case Xiangqi.Piece(`side`, role) => (Ply(state.ply + 1), role, board)
      .sequence
    moveContexts.map: contexts =>
      val roles = contexts.map(_._2)
      val blurs =
        val bools = from.pov.player.blurs.booleans
        bools.take(roles.size) ++ Array.fill((roles.size - bools.length).max(0))(false)
      val timeCvs = from.movetimes.map(slidingMoveTimesCvs)
      contexts
        .zip(blurs)
        .zip(timeCvs | Vector.fill(roles.size)(none))
        .zip(from.clockStates.map(_.map(some)) | Vector.fill(roles.size)(none))
        .zip(from.movetimes.map(_.map(some)) | Vector.fill(roles.size)(none))
        .mapWithIndex { case ((((((ply, role, board), blur), timeCv), clock), movetime), i) =>
          val prevInfo = prevInfos.lift(i)
          val awareness = from.advices
            .get(ply - 1)
            .flatMap:
              case o if o.judgment.isMistakeOrBlunder =>
                from.advices.get(ply) match
                  case Some(p) if p.judgment.isMistakeOrBlunder => false.some
                  case _ => true.some
              case _ => none
          val luck = from.advices
            .get(ply)
            .flatMap:
              case o if o.judgment.isMistakeOrBlunder =>
                from.advices.get(ply + 1) match
                  case Some(p) if p.judgment.isMistakeOrBlunder => true.some
                  case _ => false.some
              case _ => none
          val accuracyPercent = accuracyPercents.flatMap { accs =>
            accs
              .lift(i)
              .orElse:
                if i == contexts.size - 1 then // last eval missing if checkmate
                  (~from.pov.win && from.pov.game.status.is(_.Mate)).option(AccuracyPercent.perfect)
                else none // evals can be missing in super long games (300 plies, used to be 200)
          }

          InsightMove(
            phase = Phase.of(from.division, ply),
            tenths = movetime.map(_.roundTenths),
            clockPercent = from.clock.flatMap(clk => clock.map(ClockPercent(clk, _))),
            role = role,
            eval = prevInfo.flatMap(_.eval.forceAsCp).map(_.ceiled.centipawns),
            cpl = cpDiffs.lift(i).flatten,
            winPercent = prevInfo.map(_.eval).flatMap(_.score).map(WinPercent.fromScore),
            accuracyPercent = accuracyPercent,
            material = board.materialImbalance(side),
            awareness = awareness,
            luck = luck,
            blur = blur,
            timeCv = timeCv
          )
        }
        .toList

  private def slidingMoveTimesCvs(movetimes: Vector[Centis]): Seq[Option[Float]] =
    val sliding = 13 // should be odd
    val nb = movetimes.size
    if nb < sliding then Vector.fill(nb)(none[Float])
    else
      val sides = Vector.fill(sliding / 2)(none[Float])
      val cvs = movetimes
        .sliding(sliding)
        .map { a =>
          // drop outliers
          coefVariation(a.map(_.centis + 10).sorted.drop(1).dropRight(1))
        }
      sides ++ cvs ++ sides

  private def coefVariation(a: Seq[Int]): Option[Float] =
    val s = Stats(a)
    s.stdDev.map { _ / s.mean }

  private def convert(from: RichPov): Option[InsightEntry] =
    import from.*
    import pov.game
    for
      myId <- pov.player.userId
      myRating = pov.player.stableRating
      opRating = pov.opponent.stableRating
      moves <- makeMoves(from)
    yield InsightEntry(
      id = InsightEntry.povToId(pov),
      userId = myId,
      color = pov.color,
      perf = game.perfKey,
      rating = myRating,
      opponentRating = opRating,
      opponentStrength = for m <- myRating; o <- opRating yield RelativeStrength(m, o),
      moves = moves,
      result = game.winnerUserId match
        case None => Result.Draw
        case Some(u) if u == myId => Result.Win
        case _ => Result.Loss
      ,
      termination = Termination.fromStatus(game.status),
      ratingDiff = ~pov.player.ratingDiff,
      analysed = analysis.isDefined,
      provisional = provisional,
      source = game.source,
      date = game.createdAt
    )
