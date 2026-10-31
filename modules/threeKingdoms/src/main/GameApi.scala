package lila.threeKingdoms

import scalalib.actor.AsyncActorSequencers
import lila.rating.ThreeKingdomsRank
import lila.core.rank.{ RankDiff, RankTrackId }

case class MatchUpdated(game: KingdomGame)

final class GameApi(
    repo: GameRepo,
    streams: GameStreams,
    users: lila.user.UserApi,
    accounting: GameAccounting
)(using Executor, Scheduler):
  private val queue = AsyncActorSequencers[GameId](
    Max(32),
    5.minutes,
    10.seconds,
    "threeKingdoms.game",
    lila.mon.asyncActorMonitor.highCardinality
  )

  def act(id: GameId, user: UserId, revision: Int, action: String): Fu[Either[String, KingdomGame]] =
    queue(id):
      repo
        .byId(id)
        .flatMap:
          case None => fuccess(Left("gameNotFound"))
          case Some(g) if action == "leave-computer" && g.source == "computer" && g.botHost.contains(user) =>
            if g.position.finished then fuccess(Right(g))
            else g.resign(user, nowMillis).fold(e => fuccess(Left(e)), next => persist(g, next).map(Right(_)))
          case Some(g) if g.revision != revision => fuccess(Left("staleRevision"))
          case Some(g) =>
            val now = nowMillis
            val next = g.flag(now) match
              case Some(flagged) => Right(flagged)
              case None =>
                action match
                  case "resign" => g.resign(user, now)
                  case "draw" => g.draw(user, now)
                  case "takeback" => g.takeback(user, now)
                  case _ => g.move(user, action, now)
            next match
              case Left(error) => fuccess(Left(error))
              case Right(updated) => persist(g, updated).map(Right(_))

  private def persist(previous: KingdomGame, next: KingdomGame): Fu[KingdomGame] =
    repo
      .save(previous, next)
      .flatMap:
        case false => fufail("Concurrent Three Kingdoms update")
        case true =>
          streams.publish(next)
          lila.common.Bus.pub(MatchUpdated(next))
          if next.position.finished then settle(next) else fuccess(next)

  def tick(): Funit =
    repo.expired(nowMillis).flatMap { games =>
      games.traverse_ { expired =>
        queue(expired.id) {
          repo
            .byId(expired.id)
            .flatMap:
              case Some(g) => g.flag(nowMillis).fold(funit)(next => persist(g, next).void)
              case _ => funit
        }
      }
    }

  def recoverSettlements(): Funit = repo.unsettled.flatMap(_.traverse_(g => queue(g.id)(settle(g).void)))

  /** Close previously hosted bot duels without performing any engine searches. */
  def finishUnattendedDuels(): Funit = repo.unattendedDuels.flatMap(_.sequentiallyVoid: candidate =>
    queue(candidate.id):
      repo
        .byId(candidate.id)
        .flatMap:
          case Some(g) if g.unattendedDuel => persist(g, g.finishComputerDuel(nowMillis)).void
          case _ => funit)
  def forfeit(id: GameId, user: UserId): Funit = queue(id):
    repo
      .byId(id)
      .flatMap:
        case Some(game)
            if !game.position.finished && game.playerOf(user).exists(game.position.active.contains) =>
          game.resign(user, nowMillis).fold(fufail, next => persist(game, next).void)
        case _ => funit

  def resignAll(user: UserId): Funit = repo
    .activeFor(user)
    .flatMap:
      case Nil => funit
      case games => games.sequentiallyVoid(g => forfeit(g.id, user)).flatMap(_ => resignAll(user))

  private def settle(g: KingdomGame): Fu[KingdomGame] =
    if g.settled then fuccess(g)
    else
      val policy = ThreeKingdomsRank
      val diffs = if g.rated then
        policy.settleThree(
          g.seats.flatMap(_.rank),
          Kingdom.values.toVector.map(k => g.position.placement(k).get)
        )
      else Right(Vector.fill(3)(RankDiff(0)))
      diffs.fold(
        fufail,
        values =>
          users
            .byIds(g.userIds)
            .flatMap: accounts =>
              val eligible =
                g.rated && accounts.size == 3 && accounts.forall(_.rankable) && g.events.size >= 2
              g.seats.zipWithIndex.traverse: (seat, index) =>
                if !eligible then fuccess(seat)
                else
                  users
                    .updateRankAtomically(seat.userId.get, RankTrackId.threeKingdoms, policy.initial): perf =>
                      policy.applyResult(
                        perf,
                        values(index),
                        g.position.placement(Kingdom.values(index)).contains(1d),
                        g.position.ending.exists(e => e.draw && e.winners.contains(Kingdom.values(index))),
                        g.movedAt,
                        g.id
                      )
                    .map: (_, updated) =>
                      val perf = updated.rank(RankTrackId.threeKingdoms).get
                      seat.copy(rank =
                        seat.rank.map(
                          _.copy(diff = perf.settlement(g.id), after = Some(policy.catalog.code(perf.score)))
                        )
                      )
            .flatMap: seats =>
              val settled = g.copy(seats = seats, settled = true, revision = g.revision + 1)
              accounting
                .finish(g)
                .flatMap(_ => repo.save(g, settled))
                .flatMap:
                  case true =>
                    streams.publish(settled)
                    lila.common.Bus.pub(MatchUpdated(settled))
                    fuccess(settled)
                  case false => repo.byId(g.id).map(_.getOrElse(g))
      )
