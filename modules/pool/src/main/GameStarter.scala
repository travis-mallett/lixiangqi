package lila.pool

import chess.ByColor

import lila.core.game.{ GameRepo, IdGenerator, NewPlayer, Source }
import lila.core.pool.{ Pairing, Pairings }
import lila.core.rank.RankSnapshot
import lila.common.Bus
import lila.xiangqi.Xiangqi

final private class GameStarter(
    userApi: lila.core.user.UserApi,
    gameRepo: GameRepo,
    newPlayer: NewPlayer,
    idGenerator: IdGenerator,
    onStart: GameId => Unit
)(using Executor, Scheduler):

  private val workQueue = scalalib.actor.AsyncActorSequencer(
    maxSize = Max(64),
    timeout = 10.seconds,
    name = "gameStarter",
    lila.mon.asyncActorMonitor.full
  )

  def apply(pool: PoolConfig, couples: Vector[MatchMaking.Couple]): Funit =
    couples.nonEmpty.so:
      workQueue:
        for
          ids <- idGenerator.games(couples.size)
          pairingOpts <- couples.zip(ids).parallel(one(pool).tupled)
        yield
          val pairings = pairingOpts.flatten.toList
          for
            pairing <- pairings
            (sri, _) <- pairing.players.toList
          do Bus.publishDyn(pairing, s"hookRemove:$sri")
          Bus.pub(Pairings(pairings))

  private def one(pool: PoolConfig)(
      couple: MatchMaking.Couple,
      id: GameId
  ): Fu[Option[Pairing]] =
    import couple.*
    for
      p1White <- userApi.firstGetsWhite(p1.userId, p2.userId)
      (whiteMember, blackMember) = if p1White then p1 -> p2 else p2 -> p1
      game = makeGame(
        id,
        pool,
        whiteMember.userId -> whiteMember.rank,
        blackMember.userId -> blackMember.rank
      ).start
      _ <- gameRepo.insertDenormalized(game)
    yield
      onStart(game.id)
      Pairing(ByColor(whiteMember.sri -> game.fullIds.white, blackMember.sri -> game.fullIds.black)).some

  private def makeGame(
      id: GameId,
      pool: PoolConfig,
      whiteUser: (UserId, RankSnapshot),
      blackUser: (UserId, RankSnapshot)
  ) =
    lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(whiteUser, blackUser).mapWithColor: (color, userRank) =>
          newPlayer(color, userRank._1, userRank._2),
        rated = chess.Rated(pool.ranked),
        source = Source.Pool,
        pgnImport = None,
        clock = pool.clock.toClock.some,
        moveTimeLimit = pool.moveTimeLimit,
        variant = chess.variant.Standard,
        rankTrack = pool.rankTrack
      )
      .withId(id)
