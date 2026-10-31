package lila.pool

import chess.ByColor

import lila.core.game.{ GameRepo, IdGenerator, NewPlayer, Source }
import lila.core.pool.{ Pairing, Pairings }
import lila.core.rank.RankSnapshot
import lila.common.Bus

final private class GameStarter(
    userApi: lila.core.user.UserApi,
    gameRepo: GameRepo,
    newPlayer: NewPlayer,
    idGenerator: IdGenerator,
    onStart: GameId => Unit,
    participation: lila.core.pool.PoolParticipation,
    mayJoinPool: lila.core.pool.MayJoinPool
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
    mayJoinPool
      .exec(couple.p1.userId)
      .zip(mayJoinPool.exec(couple.p2.userId))
      .flatMap:
        case (true, true) => reserveAndStart(pool)(couple, id)
        case _ => fuccess(None)

  private def reserveAndStart(pool: PoolConfig)(couple: MatchMaking.Couple, id: GameId): Fu[Option[Pairing]] =
    import couple.*
    val participants = List(p1, p2)
    val unqueued = participants.filter(_.from == lila.core.pool.PoolFrom.Hook).map(_.userId).toSet
    if !participation.reserve(pool.id.value, participants.map(_.userId), id, nowMillis, unqueued) then
      fuccess(None)
    else
      (for
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
        List(whiteMember, blackMember).foreach: member =>
          member.traffic.foreach: search =>
            val event = search.event("paired", Some(member.userId), pool.id.value, "paired")
            Bus.pub(event.copy(dimensions = event.dimensions + ("game" -> game.id.value)))
        Pairing(ByColor(whiteMember.sri -> game.fullIds.white, blackMember.sri -> game.fullIds.black)).some
      ).recoverWith: error =>
        gameRepo
          .game(id)
          .flatMap:
            case Some(_) => fufail(error) // Preserve the reservation after an uncertain insert.
            case None => participation.release(id, participants.map(_.userId)); fufail(error)

  private def makeGame(
      id: GameId,
      pool: PoolConfig,
      whiteUser: (UserId, RankSnapshot),
      blackUser: (UserId, RankSnapshot)
  ) =
    lila.core.game
      .newGame(
        xiangqi =
          pool.gameVariant.initialGame(None, pool.gameVariant.defaultRuleset).fold(sys.error, identity),
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
