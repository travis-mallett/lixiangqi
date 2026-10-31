package lila.threeKingdoms

import lila.rating.ThreeKingdomsRank
import lila.core.rank.RankTrackId

final class GameMaker(repo: GameRepo, users: lila.user.UserApi)(using Executor):
  def existing(id: GameId): Fu[Option[KingdomGame]] = repo.byId(id)
  def completeLocal(game: KingdomGame): Fu[KingdomGame] =
    def recover = repo
      .byId(game.id)
      .flatMap:
        case Some(existing)
            if existing.source == "local-completion" && existing.seats == game.seats &&
              existing.events.dropRight(1) == game.events.dropRight(1) =>
          fuccess(existing)
        case _ => fufail("Three Kingdoms game ID collision")
    repo
      .insert(game)
      .map(_ => game)
      .recoverWith:
        case e: reactivemongo.api.commands.WriteResult if lila.db.isDuplicateKey(e) => recover
  def seats(ids: Vector[UserId]): Fu[Vector[Seat]] = ids.traverse: id =>
    users
      .perfsOf(id)
      .map: perfs =>
        Seat(
          Some(id),
          None,
          Some(
            ThreeKingdomsRank
              .snapshot(perfs.rank(RankTrackId.threeKingdoms).getOrElse(ThreeKingdomsRank.initial))
          )
        )

  def create(
      seats: Vector[Seat],
      config: ClockConfig,
      source: String,
      id: GameId = GameId(scalalib.SecureRandom.nextString(GameId.size)),
      initial: Position = Position.initial,
      tournament: Option[TourId] = None
  ): Fu[KingdomGame] =
    val now = nowInstant
    val game = KingdomGame(
      id,
      seats,
      initial,
      initial,
      ClockState.start(config, now.toEpochMilli),
      now,
      now,
      rated = source == "pool",
      source = source,
      tournamentId = tournament
    )
    if game.rated && ThreeKingdomsRank.settleThree(seats.flatMap(_.rank), Vector(1d, 2d, 3d)).isLeft then
      fufail("Incompatible Three Kingdoms ranks")
    else
      repo
        .insert(game)
        .map: _ =>
          lila.common.Bus.pub(MatchUpdated(game))
          game
        .recoverWith:
          case e: reactivemongo.api.commands.WriteResult if lila.db.isDuplicateKey(e) =>
            repo
              .byId(id)
              .flatMap:
                case Some(existing)
                    if existing.seats.map(s => s.userId -> s.aiLevel) == seats
                      .map(s => s.userId -> s.aiLevel) &&
                      existing.source == source && existing.initial == initial && existing.clock.config == config =>
                  fuccess(existing)
                case _ => fufail("Three Kingdoms game ID collision")

  def computer(user: UserId, color: Kingdom, level: Int, config: ClockConfig): Fu[KingdomGame] =
    seats(Vector(user)).flatMap: human =>
      create(
        Kingdom.values.toVector.map(k => if k == color then human.head else Seat(None, Some(level), None)),
        config,
        "computer"
      )
