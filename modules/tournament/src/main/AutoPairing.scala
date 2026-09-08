package lila.tournament

import chess.{ Black, ByColor, Color, White }
import monocle.syntax.all.*

import lila.core.game.Source
import lila.xiangqi.XiangqiRules

final class AutoPairing(
    gameRepo: lila.core.game.GameRepo,
    newPlayer: lila.core.game.NewPlayer,
    duelStore: DuelStore,
    lightUserApi: lila.core.user.LightUserApi,
    onStart: lila.core.game.OnStart
)(using Executor):

  def apply(tour: Tournament, pairing: Pairing.WithPlayers, ranking: Ranking): Fu[Game] = for
    xiangqiGame <- XiangqiRules.initialGame(tour.position.map(_.value), tour.ruleset).fold(fufail, fuccess)
    clock = tour.clock.toClock
    game = lila.core.game
      .newGame(
        xiangqi = xiangqiGame,
        players = ByColor(makePlayer(White, pairing.player1), makePlayer(Black, pairing.player2)),
        rated = chess.Rated.No,
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
      duelStore.add(
        tour = tour.id,
        game = game.id,
        p1 = usernameOf(pairing.player1) -> pairing.player1.rank,
        p2 = usernameOf(pairing.player2) -> pairing.player2.rank,
        ranking = ranking
      )
  yield game

  private def makePlayer(color: Color, player: Player) =
    newPlayer(color, player.userId, player.rank)

  private def usernameOf(player: Player) = lightUserApi.syncFallback(player.userId).name
