package lila.challenge

import chess.variant.{ FromPosition, Standard }
import chess.{ Clock, Ply }

import lila.xiangqi.Xiangqi

final class JoinerTest extends munit.FunSuite:

  val timeControl =
    Challenge.TimeControl.Clock(Clock.Config(Clock.LimitSeconds(300), Clock.IncrementSeconds(0)))

  test("standard challenge starts from the native Xiangqi root"):
    val challenge = makeChallenge(Standard, None)
    val game = ChallengeJoiner.createGame(challenge, None, None, Xiangqi.Game.initial)
    assertEquals(game.startedAtPly, Ply.initial)
    assertEquals(game.xiangqi.initialFen, Xiangqi.startFen)
    assertEquals(game.xiangqi.moves, Vector.empty)
    assertEquals(game.variant, Standard)

  test("from-position challenge preserves canonical Xiangqi ply and FEN"):
    val fen = "4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 7"
    val state = Xiangqi.Game.initial.state.copy(fen = fen, ply = 13, turn = Xiangqi.Side.Black)
    val xiangqi = Xiangqi.Game.fromState(fen, state).fold(fail(_), identity)
    val challenge =
      makeChallenge(FromPosition, Some[chess.format.Fen.Full](chess.format.Fen.Full(fen)))
    val game = ChallengeJoiner.createGame(challenge, None, None, xiangqi)
    assertEquals(game.startedAtPly, Ply(13))
    assertEquals(game.xiangqi.initialFen, fen)
    assertEquals(game.rated, chess.Rated.No)
    assertEquals(game.variant, FromPosition)

  private def makeChallenge(
      variant: chess.variant.Variant,
      initialFen: Option[chess.format.Fen.Full]
  ) =
    Challenge.make(
      variant = variant,
      initialFen = initialFen,
      timeControl = timeControl,
      rated = chess.Rated.No,
      color = "white",
      challenger = Challenge.Challenger.Anonymous("secret"),
      destUser = None,
      rematchOf = None
    )
