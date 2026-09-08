package lila.fishnet

import chess.{ Black, White }
import chess.format.Fen

import lila.core.fishnet.FishnetMoveRequest

/** Submits AI turns through Lila's established Fishnet move-work boundary. */
final class FishnetPlayer(redis: FishnetRedis)(using Executor):

  def apply(request: FishnetMoveRequest): Funit =
    request.game.aiLevel
      .so: level =>
        makeWork(request, level).addEffect(redis.request).void
      .recover:
        case error: Exception => logger.info(error.getMessage)

  private def makeWork(request: FishnetMoveRequest, level: Int): Fu[Work.Move] =
    val game = request.game
    if game.playable && game.player.isAi && !game.position.ended &&
      lila.core.fishnet.AiTurnKey.from(game).contains(request.turnKey)
    then
      if game.playedPlies < lila.core.fishnet.maxPlies then
        fuccess:
          Work.Move(
            _id = Work.Id(request.requestId.value),
            game = Work.Game(
              id = game.id.value,
              initialFen = Some[Fen.Full](Fen.Full(game.xiangqi.initialFen)),
              studyId = none,
              variant = game.variant,
              moves = game.xiangqi.moves.map(_.value).mkString(" ")
            ),
            level = lila.core.fishnet.AiTurnKey.effectiveLevel(game, level),
            clock = game.clock.map: clock =>
              Work.Clock(
                wtime = (game.effectiveClockRemaining(White) | clock.remainingTime(White)).centis,
                btime = (game.effectiveClockRemaining(Black) | clock.remainingTime(Black)).centis,
                inc = clock.incrementSeconds
              ),
            turnKey = request.turnKey,
            ruleset = game.xiangqi.ruleset,
            legalMoves = game.position.legalMoves
          )
      else fufail(s"[fishnet] Too many moves (${game.ply}), won't play ${game.id}")
    else fufail(s"[fishnet] invalid or stale Xiangqi AI turn on ${game.id}")
