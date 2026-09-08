package lila.core.game

import chess.{ Black, ByColor, Clock, Rated, White }

import lila.core.id.GamePlayerId
import lila.core.rank.{ RankCode, RankScore, RankSnapshot, RankTrackId }
import lila.core.userId.UserId
import lila.xiangqi.Xiangqi

class RankedGameTest extends munit.FunSuite:

  private val clock = Clock.Config(Clock.LimitSeconds(15 * 60), Clock.IncrementSeconds(0))
  private val moveTime = MoveTimeLimit(90, Some(MoveTimeLimit.FirstPhase(3, 30)))
  private val snapshot = RankSnapshot(
    track = RankTrackId.xiangqi,
    score = RankScore(-160),
    code = RankCode("学1-3"),
    ordinal = 2,
    catalogVersion = 1,
    policyVersion = 1,
    established = false
  )
  private val players = ByColor(
    Player(
      GamePlayerId("rankred1"),
      White,
      aiLevel = None,
      userId = Some(UserId("rank-red")),
      rank = Some(snapshot)
    ),
    Player(
      GamePlayerId("rankblk1"),
      Black,
      aiLevel = None,
      userId = Some(UserId("rank-black")),
      rank = Some(snapshot)
    )
  )

  test("authorizes only the canonical 15-minute Xiangqi pool"):
    assertEquals(
      RankedGame.authorize(
        Some(RankTrackId.xiangqi),
        Source.Pool,
        chess.variant.Standard,
        Some(clock),
        Some(moveTime),
        players
      ),
      Some(RankTrackId.xiangqi)
    )
    assertEquals(
      RankedGame.authorize(
        Some(RankTrackId.xiangqi),
        Source.Lobby,
        chess.variant.Standard,
        Some(clock),
        Some(moveTime),
        players
      ),
      None
    )
    assertEquals(
      RankedGame.authorize(
        Some(RankTrackId.xiangqi),
        Source.Pool,
        chess.variant.Standard,
        Some(Clock.Config(Clock.LimitSeconds(10 * 60), Clock.IncrementSeconds(0))),
        Some(moveTime),
        players
      ),
      None
    )

  test("a legacy rated flag cannot create a ranked game, without discarding display ranks"):
    val game = newGame(
      xiangqi = Xiangqi.Game.initial,
      players = players,
      rated = Rated.Yes,
      source = Source.Friend,
      pgnImport = None,
      clock = Some(Clock(clock)),
      moveTimeLimit = Some(moveTime),
      rankTrack = Some(RankTrackId.xiangqi)
    ).sloppy

    assertEquals(game.rankTrack, None)
    assertEquals(game.rated, Rated.No)
    assertEquals(game.players.flatMap(_.rank).size, 2)
