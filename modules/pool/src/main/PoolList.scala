package lila.pool

import chess.Clock
import play.api.libs.json.Json

import lila.core.pool.IsClockCompatible
import lila.core.game.{ MoveTimeLimit, RankedGame }
import lila.core.rank.RankTrackId

object PoolList:

  import PoolConfig.{ *, given }

  extension (i: Int)
    def ++(increment: Int) = Clock.Config(Clock.LimitSeconds(i * 60), Clock.IncrementSeconds(increment))
    def players = NbPlayers(i)

  val lobby: List[PoolConfig] = List(
    PoolConfig(1 ++ 0, Wave(12.seconds, 40.players)),
    PoolConfig(2 ++ 1, Wave(18.seconds, 30.players)),
    PoolConfig(3 ++ 0, Wave(12.seconds, 40.players)),
    PoolConfig(3 ++ 2, Wave(22.seconds, 30.players)),
    PoolConfig(5 ++ 0, Wave(14.seconds, 40.players)),
    PoolConfig(5 ++ 3, Wave(25.seconds, 26.players)),
    PoolConfig(10 ++ 0, Wave(13.seconds, 30.players)),
    PoolConfig(10 ++ 5, Wave(20.seconds, 30.players)),
    PoolConfig(15 ++ 10, Wave(30.seconds, 20.players)),
    PoolConfig(30 ++ 0, Wave(40.seconds, 20.players)),
    PoolConfig(30 ++ 20, Wave(60.seconds, 20.players))
  )

  val homepage: List[PoolConfig] = List(
    PoolConfig(
      clock = RankedGame.xiangqiClock,
      wave = Wave(30.seconds, 20.players),
      moveTimeLimit = RankedGame.xiangqiMoveTime.some,
      rankTrack = RankTrackId.xiangqi.some
    ),
    homepagePool(minutes = 5, normalMoveSeconds = 60, wave = Wave(14.seconds, 40.players)),
    homepagePool(minutes = 10, normalMoveSeconds = 60, wave = Wave(13.seconds, 30.players)),
    homepagePool(minutes = 20, normalMoveSeconds = 60, wave = Wave(30.seconds, 20.players))
  )

  val all: List[PoolConfig] = lobby ::: homepage

  private def homepagePool(
      minutes: Int,
      normalMoveSeconds: Int,
      wave: Wave,
      rankTrack: Option[RankTrackId] = None
  ) =
    PoolConfig(
      minutes ++ 0,
      wave,
      MoveTimeLimit(
        normalMoveSeconds,
        MoveTimeLimit.FirstPhase(moves = 3, seconds = 30).some
      ).some,
      rankTrack = rankTrack
    )

  private val timeControls = all.view.map(p => p.clock -> p.moveTimeLimit).toSet

  given isClockCompatible: IsClockCompatible = IsClockCompatible: (clock, moveTimeLimit) =>
    timeControls.contains(clock -> moveTimeLimit)

  def json = Json.toJson(lobby)
  def homepageJson = Json.toJson(homepage)
