package lila.tournament

import reactivemongo.api.bson.*

import lila.db.dsl.*

final class TournamentStatsApi(
    pairingRepo: PairingRepo,
    mongoCache: lila.memo.MongoCache.Api,
    tournamentRepo: TournamentRepo,
    kingdomsRepo: lila.threeKingdoms.GameRepo
)(using Executor):

  def apply(tournament: Tournament): Fu[Option[TournamentStats]] =
    tournament.isFinished.optionFu(cache.get(tournament.id))

  private given lila.db.BSON[TournamentStats] with
    def reads(r: lila.db.BSON.Reader) = TournamentStats(
      r.int("games"),
      r.int("moves"),
      r.int("whiteWins"),
      r.int("blackWins"),
      r.int("draws"),
      r.int("berserks"),
      r.intO("greenWins").getOrElse(0)
    )
    def writes(w: lila.db.BSON.Writer, s: TournamentStats) = $doc(
      "games" -> s.games,
      "moves" -> s.moves,
      "whiteWins" -> s.whiteWins,
      "blackWins" -> s.blackWins,
      "draws" -> s.draws,
      "berserks" -> s.berserks,
      "greenWins" -> s.greenWins
    )

  private val cache = mongoCache[TourId, TournamentStats](64, "tournament:stats", 60.days, _.value): loader =>
    _.expireAfterAccess(10.minutes)
      .maximumSize(256)
      .buildAsyncFuture(loader(fetch))

  private def fetch(tournamentId: TourId): Fu[TournamentStats] =
    tournamentRepo
      .byId(tournamentId)
      .flatMap:
        case Some(tour) if tour.gameVariant == lila.xiangqi.GameVariant.ThreeKingdoms =>
          kingdomsRepo
            .tournamentResults(tour.id, until = Some(tour.scoredUntil))
            .map: games =>
              import lila.threeKingdoms.Kingdom
              def wins(k: Kingdom) = games.count(_.position.placement(k).contains(1d))
              TournamentStats(
                games.size,
                games.map(_.position.ply).sum,
                wins(Kingdom.Shu),
                wins(Kingdom.Wei),
                games.count(_.position.ending.exists(_.draw)),
                0,
                wins(Kingdom.Wu)
              )
        case _ => pairingRepo.rawStats(tournamentId).map(TournamentStats.readAggregation)

case class TournamentStats(
    games: Int,
    moves: Int,
    whiteWins: Int,
    blackWins: Int,
    draws: Int,
    berserks: Int,
    greenWins: Int = 0
)

private object TournamentStats:

  private case class ColorStats(games: Int, moves: Int, b1: Int, b2: Int):
    def berserks = b1 + b2

  def readAggregation(docs: List[Bdoc]): TournamentStats =
    val colorStats: Map[Option[Color], ColorStats] = docs.view.map { doc =>
      doc.getAsOpt[Boolean]("_id").map(Color.fromWhite(_)) ->
        ColorStats(
          ~doc.int("games"),
          ~doc.int("moves"),
          ~doc.int("b1"),
          ~doc.int("b2")
        )
    }.toMap
    TournamentStats(
      games = colorStats.foldLeft(0)(_ + _._2.games),
      moves = colorStats.foldLeft(0)(_ + _._2.moves),
      whiteWins = colorStats.get(Color.White.some).so(_.games),
      blackWins = colorStats.get(Color.Black.some).so(_.games),
      draws = colorStats.get(none).so(_.games),
      berserks = colorStats.foldLeft(0)(_ + _._2.berserks)
    )
