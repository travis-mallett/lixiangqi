package lila.tournament

import chess.{ Black, ByColor, Color, White }
import chess.IntRating
import monocle.syntax.all.*

import lila.core.game.Source
import alleycats.Zero
import lila.xiangqi.XiangqiRules

final class AutoPairing(
    gameRepo: lila.core.game.GameRepo,
    newPlayer: lila.core.game.NewPlayer,
    duelStore: DuelStore,
    lightUserApi: lila.core.user.LightUserApi,
    onStart: lila.core.game.OnStart
)(using Executor):

  def apply(tour: Tournament, pairing: Pairing.WithPlayers, ranking: Ranking): Fu[Game] = for
    xiangqiGame <- XiangqiRules.initialGame(tour.position.map(_.value)).fold(fufail, fuccess)
    clock = tour.clock.toClock
    game = lila.core.game
      .newGame(
        xiangqi = xiangqiGame,
        players = ByColor(makePlayer(White, pairing.player1), makePlayer(Black, pairing.player2)),
        rated = tour.rated,
        source = Source.Arena,
        pgnImport = None,
        clock = clock.some,
        startedAtPly = chess.Ply(xiangqiGame.state.ply),
        variant = if tour.position.isDefined then chess.variant.FromPosition else tour.variant
      )
      .withId(pairing.pairing.gameId)
      .focus(_.metadata.tournamentId)
      .replace(tour.id.some)
      .start
    _ <- gameRepo.insertDenormalized(game)
    _ =
      onStart.exec(game.id)
      given Zero[IntRating] = Zero(IntRating(0))
      duelStore.add(
        tour = tour.id,
        game = game.id,
        p1 = usernameOf(pairing.player1) -> ~game.whitePlayer.rating,
        p2 = usernameOf(pairing.player2) -> ~game.blackPlayer.rating,
        ranking = ranking
      )
  yield game

  private def makePlayer(color: Color, player: Player) =
    newPlayer(color, player.userId, player.rating, player.provisional)

  private def usernameOf(player: Player) = lightUserApi.syncFallback(player.userId).name
