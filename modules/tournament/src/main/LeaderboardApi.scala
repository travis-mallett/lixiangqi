package lila.tournament

import org.apache.pekko.stream.scaladsl.*
import reactivemongo.api.bson.*
import reactivemongo.pekkostream.cursorProducer
import scalalib.Maths
import scalalib.paginator.{ AdapterLike, Paginator }

import lila.core.chess.Rank
import lila.db.dsl.{ *, given }

final class LeaderboardApi(
    repo: LeaderboardRepo,
    tournamentRepo: TournamentRepo
)(using Executor, org.apache.pekko.stream.Materializer)
    extends lila.core.tournament.leaderboard.Api:

  import LeaderboardApi.*
  import BSONHandlers.given

  private val maxPerPage = MaxPerPage(20)

  def recentByUser(user: User, page: Int) = paginator(user, page, sortBest = false)

  def bestByUser(user: User, page: Int) = paginator(user, page, sortBest = true)

  def timeRange(userId: UserId, range: TimeInterval): Fu[List[Entry]] =
    repo.coll
      .find:
        $doc(
          "u" -> userId,
          "d".$gte(range.start).$lt(range.end)
        )
      .sort($sort.desc("d"))
      .cursor[Entry](ReadPref.sec)
      .list(100)

  def chart(user: User): Fu[ChartData] =
    repo.coll
      .aggregateList(Int.MaxValue, _.sec): framework =>
        import framework.*
        Match($doc("u" -> user.id)) -> List(
          Group(BSONNull)("nb" -> SumAll, "points" -> PushField("s"), "ratios" -> PushField("w"))
        )
      .map:
        _.headOption.fold(ChartData.empty): doc =>
          ChartData(
            ChartData.PerfResult(
              nb = ~doc.int("nb"),
              points = ChartData.Ints(doc.getAsOpt[List[Int]]("points") | Nil),
              rank = ChartData.Ints(doc.getAsOpt[List[Int]]("ratios") | Nil)
            )
          )

  def getAndDeleteRecent(userId: UserId, since: Instant): Fu[List[TourId]] = for
    entries <- repo.coll.list[Entry]($doc("u" -> userId, "d".$gt(since)))
    _ <- entries.nonEmpty.so:
      repo.coll.delete.one($inIds(entries.map(_.id))).void
  yield entries.map(_.tourId)

  def byPlayerStream(
      userId: UserId,
      @annotation.unused withPerformance: Boolean,
      perSecond: MaxPerSecond,
      nb: Int
  ): Source[TourEntry, ?] =
    repo.coll
      .aggregateWith[Bdoc](): fw =>
        aggregateByPlayer(userId, fw, fw.Descending("d"), nb, offset = 0).toList
      .documentSource()
      .mapConcat(readTourEntry)
      .throttle(perSecond.value, 1.second)

  private def aggregateByPlayer(
      userId: UserId,
      framework: repo.coll.AggregationFramework.type,
      sort: framework.SortOrder,
      nb: Int,
      offset: Int
  ): NonEmptyList[framework.PipelineOperator] =
    import framework.*
    NonEmptyList
      .of(
        Match($doc("u" -> userId)),
        Sort(sort),
        Skip(offset),
        Limit(nb),
        PipelineOperator(
          $lookup.simple(
            from = tournamentRepo.coll,
            as = "tour",
            local = "t",
            foreign = "_id"
          )
        ),
        UnwindField("tour")
      )

  private def paginator(user: User, page: Int, sortBest: Boolean): Fu[Paginator[TourEntry]] =
    Paginator(
      currentPage = page,
      maxPerPage = maxPerPage,
      adapter = new AdapterLike[TourEntry]:
        private val selector = $doc("u" -> user.id)
        def nbResults: Fu[Int] = repo.coll.countSel(selector)
        def slice(offset: Int, length: Int): Fu[Seq[TourEntry]] =
          repo.coll
            .aggregateList(length, _.sec): framework =>
              val sort = if sortBest then framework.Ascending("w") else framework.Descending("d")
              val pipe = aggregateByPlayer(user.id, framework, sort, length, offset)
              pipe.head -> pipe.tail
            .map(_.flatMap(readTourEntry))
    )

  private def readTourEntry(doc: Bdoc): Option[TourEntry] = for
    entry <- doc.asOpt[Entry]
    tour <- doc.getAsOpt[Tournament]("tour")
  yield TourEntry(tour, entry)

object LeaderboardApi:

  import lila.core.tournament.leaderboard.Ratio

  private val rankRatioMultiplier = 100 * 1000

  case class TourEntry(tour: Tournament, entry: Entry)

  case class Entry(
      id: TourPlayerId,
      userId: UserId,
      tourId: TourId,
      nbGames: Int,
      score: Int,
      rank: Rank,
      rankRatio: Ratio, // ratio * rankRatioMultiplier. function of rank and tour.nbPlayers. less is better.
      date: Instant
  ) extends lila.core.tournament.leaderboard.Entry

  case class ChartData(result: ChartData.PerfResult)

  object ChartData:

    val empty = ChartData(PerfResult(0, Ints(Nil), Ints(Nil)))

    case class Ints(v: List[Int]):
      def median = Maths.median(v)
      def sum = v.sum

    case class PerfResult(nb: Int, points: Ints, rank: Ints):
      private def rankPercent(n: Double) = (n * 100 / rankRatioMultiplier).toInt
      def rankPercentMedian = rank.median.map(rankPercent)
