package lila.core.game

import chess.{ ByColor, Clock, Color, Rated, Status }
import lila.core.id.GamePlayerId
import lila.core.pool.*
import lila.core.rank.RankTrackId
import lila.core.socket.Sris
import lila.core.userId.UserId
import lila.xiangqi.Xiangqi

class GamePresenceTest extends munit.FunSuite:
  private val featured = PoolConfigId.from(RankedGame.xiangqiClock, Some(RankedGame.xiangqiMoveTime))
  private val casualClock = Clock.Config(Clock.LimitSeconds(300), Clock.IncrementSeconds(0))
  private val casualLimit = MoveTimeLimit(60, Some(MoveTimeLimit.FirstPhase(moves = 3, seconds = 30)))
  private val casual = PoolConfigId.from(casualClock, Some(casualLimit))
  private val jieqiPool = PoolConfigId("jieqi-v1-ranked-10+0-m60-30x3")
  private val pools = new PoolApi:
    def setOnlineSris(ids: Sris): Unit = ()
    def poolRankTracks: Map[PoolConfigId, Option[RankTrackId]] = Map.empty
    def homepagePoolIds = Set(featured, casual, jieqiPool)
    def join(id: PoolConfigId, member: PoolMember): Unit = ()
    def leave(id: PoolConfigId, user: UserId): Unit = ()
    def poolOf(clock: Clock.Config, limit: Option[MoveTimeLimit], variant: lila.xiangqi.GameVariant) = Some(
      if variant == lila.xiangqi.GameVariant.Jieqi then jieqiPool else PoolConfigId.from(clock, limit)
    )

  private def game(source: Source) = newGame(
    xiangqi = Xiangqi.Game.initial,
    players = ByColor(
      Player(GamePlayerId("red1"), Color.white, None),
      Player(GamePlayerId("blk1"), Color.black, None)
    ),
    rated = Rated.No,
    source = source,
    pgnImport = None
  ).sloppy

  test("featured and casual games use the same rooms regardless of client or creation path"):
    for source <- List(Source.Pool, Source.Lobby) do
      val ranked = game(source).copy(
        clock = Some(RankedGame.xiangqiClock.toClock),
        moveTimeLimit = Some(RankedGame.xiangqiMoveTime)
      )
      assertEquals(GamePresence(ranked, pools), Some(featured.value) -> None)
      val quick = game(source).copy(clock = Some(casualClock.toClock), moveTimeLimit = Some(casualLimit))
      assertEquals(GamePresence(quick, pools), Some(casual.value) -> Some("other"))

  test("custom, friend and computer categories and finished games"):
    assertEquals(GamePresence(game(Source.Lobby), pools), Some("lobby") -> Some("other"))
    assertEquals(GamePresence(game(Source.Friend), pools), Some("friend") -> None)
    assertEquals(GamePresence(game(Source.Ai), pools), Some("ai") -> None)
    val positionAi = game(Source.Position).updatePlayer(Color.black, _.copy(aiLevel = Some(98)))
    assertEquals(GamePresence(positionAi, pools), Some("ai") -> None)
    for status <- List(Status.Aborted, Status.Resign, Status.Mate, Status.Draw) do
      assertEquals(GamePresence(game(Source.Lobby).copy(status = status), pools), None -> None)

  test("Jieqi uses distinct computer, friend and rated rooms and excludes finished games"):
    def jieqi(source: Source) = game(source).copy(
      xiangqi = lila.xiangqi.Jieqi.initial().toOption.get,
      clock = Some(RankedGame.jieqiClock.toClock),
      moveTimeLimit = Some(RankedGame.jieqiMoveTime)
    )
    assertEquals(GamePresence(jieqi(Source.Pool), pools), Some(jieqiPool.value) -> None)
    assertEquals(GamePresence(jieqi(Source.Friend), pools), Some("jieqi-friend") -> None)
    assertEquals(GamePresence(jieqi(Source.Ai), pools), Some("jieqi-ai") -> None)
    val ai = jieqi(Source.Position).updatePlayer(Color.black, _.copy(aiLevel = Some(1)))
    assertEquals(GamePresence(ai, pools), Some("jieqi-ai") -> None)
    for source <- List(Source.Pool, Source.Friend, Source.Ai) do
      assertEquals(GamePresence(jieqi(source).copy(status = Status.Mate), pools), None -> None)
