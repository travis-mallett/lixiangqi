package lila.round

import chess.{ ByColor, Color, Rated, Status }

import lila.core.game.{ Game, Player, Source }
import lila.xiangqi.Xiangqi

class PlayingRoundCountTest extends munit.FunSuite:
  given Executor = scala.concurrent.ExecutionContext.global

  private val game: Game = lila.core.game
    .newGame(
      xiangqi = Xiangqi.Game.initial,
      players = ByColor(
        Player(GamePlayerId("red1"), Color.White, aiLevel = None),
        Player(GamePlayerId("black1"), Color.Black, aiLevel = None)
      ),
      rated = Rated.No,
      source = Source.Friend,
      pgnImport = None
    )
    .withId(GameId("count123"))

  private def count(games: Option[Game]*) =
    RoundSocket.countPlaying(games.toList.map(fuccess))

  test("spectating created, finished, aborted or missing games does not count as play"):
    count(
      Some(game),
      Some(game.start),
      Some(game.start.copy(status = Status.Mate)),
      Some(game.start.copy(status = Status.Draw)),
      Some(game.start.abort),
      None
    ).map(total => assertEquals(total, 1))

  test("a game stops counting when it finishes even while its round remains loaded"):
    val playing = game.start
    for
      before <- count(Some(playing))
      after <- count(Some(playing.copy(status = Status.Resign)))
    yield
      assertEquals(before, 1)
      assertEquals(after, 0)

  test("the snapshot waits for games already loading without creating spectator-based counts"):
    val loaded = Promise[Option[Game]]()
    val snapshot = RoundSocket.countPlaying(List(loaded.future))
    assert(!snapshot.isCompleted)
    loaded.success(Some(game.start.copy(status = Status.Mate)))
    snapshot.map(total => assertEquals(total, 0))
