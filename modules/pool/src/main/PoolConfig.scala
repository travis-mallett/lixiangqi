package lila.pool

import lila.core.pool.PoolConfigId
import lila.core.game.MoveTimeLimit
import lila.core.rank.RankTrackId
import lila.core.rank.RankTrackId.*

case class PoolConfig(
    clock: chess.Clock.Config,
    wave: PoolConfig.Wave,
    moveTimeLimit: Option[MoveTimeLimit] = None,
    rankTrack: Option[RankTrackId] = None
):
  val perfKey = PerfKey(chess.Speed(clock).key.value) | PerfKey.classical
  val id = PoolConfig.toId(clock, moveTimeLimit)
  def ranked = rankTrack.isDefined

object PoolConfig:

  opaque type NbPlayers = Int
  object NbPlayers extends OpaqueInt[NbPlayers]

  case class Wave(every: FiniteDuration, players: NbPlayers)

  def toId(clock: chess.Clock.Config, moveTimeLimit: Option[MoveTimeLimit]) =
    PoolConfigId.from(clock, moveTimeLimit)

  import play.api.libs.json.*
  import lila.common.Json.given
  given OWrites[PoolConfig] = OWrites: p =>
    Json
      .obj(
        "id" -> p.id,
        "lim" -> p.clock.limitInMinutes,
        "inc" -> p.clock.incrementSeconds,
        "name" -> "Xiangqi",
        "ranked" -> p.ranked
      )
      .add("rankTrack" -> p.rankTrack.map(_.value))
      .add("moveTime" -> p.moveTimeLimit.map: limit =>
        Json
          .obj("seconds" -> limit.seconds)
          .add("first" -> limit.first.map: first =>
            Json.obj("moves" -> first.moves, "seconds" -> first.seconds)))
