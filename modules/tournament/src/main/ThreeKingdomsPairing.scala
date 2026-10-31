package lila.tournament

import lila.threeKingdoms.{ ClockConfig, KingdomGame, TournamentResult }

/** Runs inside TournamentApi's per-tournament sequencer, just like two-seat pairing. The persisted game
  * itself is the pairing: no second record can get orphaned.
  */
final private class ThreeKingdomsPairing(
    repo: lila.threeKingdoms.GameRepo,
    maker: lila.threeKingdoms.GameMaker,
    playerRepo: PlayerRepo
)(using Executor):
  def create(tour: Tournament, waiting: WaitingUsers, ranking: Ranking): Fu[List[KingdomGame]] =
    for
      history <- repo.tournamentResults(tour.id, recent = Some(300))
      ongoing <- repo.tournamentResults(tour.id, playingOnly = true)
      players <- playerRepo.byTourAndUserIds(tour.id, waiting.all)
      active = players.filter(_.active).map(_.userId).toSet
      playing = ongoing.flatMap(_.users).toSet
      available = waiting.hash.filter((id, _) => active.contains(id) && !playing.contains(id))
      groups = ThreeKingdomsPairing.groups(
        available,
        ranking.view.mapValues(_.value).toMap,
        history,
        Option.when(tour.isTeamBattle)(players.flatMap(p => p.team.map(p.userId -> _)).toMap)
      )
      games <- groups.sequentially: ids =>
        maker
          .seats(ids)
          .flatMap(
            maker.create(
              _,
              ClockConfig(tour.clock.limitSeconds.value, 60),
              "tournament",
              tournament = Some(tour.id)
            )
          )
    yield games

private[tournament] object ThreeKingdomsPairing:
  def groups(
      waiting: Map[UserId, Instant],
      ranking: Map[UserId, Int],
      history: List[TournamentResult],
      teams: Option[Map[UserId, TeamId]] = None
  ): List[Vector[UserId]] =
    var remaining = waiting.keys.toList.sortBy(u => (waiting(u).toEpochMilli, u.value)).take(240)
    val encounters = history
      .takeRight(100)
      .flatMap(_.users.combinations(2).map(_.toSet))
      .groupMapReduce(identity)(_ => 1)(_ + _)
    val seatCounts = history.flatMap(_.users.zipWithIndex).groupMapReduce(identity)(_ => 1)(_ + _)
    def repeats(a: UserId, b: UserId) = encounters.getOrElse(Set(a, b), 0)
    def distinctTeams(ids: List[UserId]) = teams.forall(t => ids.flatMap(t.get).distinct.size == ids.size)
    val result = List.newBuilder[Vector[UserId]]
    while remaining.size >= 3 do
      val first = remaining.head
      // Bound the search while preserving priority for the longest-waiting player.
      val ordered = remaining.tail
        .filter(u => distinctTeams(List(first, u)))
        .sortBy(u => (math.abs(ranking.getOrElse(u, 0) - ranking.getOrElse(first, 0)), waiting(u)))
      val candidates =
        (ordered.take(24) ++ teams.toList.flatMap(t => ordered.distinctBy(t.get).take(3))).distinct
      val pair = candidates
        .combinations(2)
        .filter(ps => distinctTeams(first :: ps))
        .minByOption: ps =>
          (
            repeats(first, ps(0)) + repeats(first, ps(1)) + repeats(ps(0), ps(1)),
            ps.map(u => math.abs(ranking.getOrElse(u, 0) - ranking.getOrElse(first, 0))).sum
          )
      pair match
        case None => remaining = remaining.tail
        case Some(opponents) =>
          val ids = first :: opponents
          // Balance each player's three seat counts, including Shu's first move.
          val seats = ids.permutations.minBy: order =>
            order.zipWithIndex.map((u, i) => seatCounts.getOrElse(u -> i, 0)).sum
          result += seats.toVector
          remaining = remaining.filterNot(ids.contains)
    result.result()
