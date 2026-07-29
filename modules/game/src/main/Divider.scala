package lila.game

import chess.{ Division, Ply }
import com.github.blemale.scaffeine.Cache
import lila.xiangqi.Xiangqi

final class Divider(using Executor) extends lila.core.game.Divider:

  private type CacheKey = (GameId, Int, Int)

  private val cache: Cache[CacheKey, Division] = lila.memo.CacheApi.scaffeineNoScheduler
    .expireAfterAccess(5.minutes)
    .build[CacheKey, Division]()

  def forGame(game: CoreGame): Division =
    apply(game.id, game.xiangqi.states.map(_.fen))

  def apply(id: GameId, positions: => Vector[String]): Division =
    val all = positions
    cache.get((id, all.size, all.hashCode), _ => noCache(all))

  private def noCache(positions: Vector[String]) =
    positions.traverse(Xiangqi.Fen.board) match
      case None => Division.empty
      case Some(boards) =>
        val division = Xiangqi.phaseDivision(boards)
        Division(division.middle.map(Ply.apply), division.end.map(Ply.apply), Ply(division.plies))
