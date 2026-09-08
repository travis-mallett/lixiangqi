package lila.user

import reactivemongo.api.*
import reactivemongo.api.bson.*
import reactivemongo.api.commands.WriteResult
import chess.IntRating
import chess.rating.glicko.Glicko

import lila.core.perf.{ UserPerfs, UserWithPerfs }
import lila.core.user.WithPerf
import lila.db.dsl.{ *, given }
import lila.db.isDuplicateKey
import lila.rating.{ Perf, PerfType, UserPerfs }
import lila.core.rank.{ RankPerf, RankSnapshot, RankTrackId }
import lila.core.rank.RankTrackId.*

final class UserPerfsRepo(c: Coll)(using Executor) extends lila.core.user.PerfsRepo(c):

  import lila.rating.UserPerfs.userPerfsHandler
  import lila.rating.UserPerfs.rankPerfHandler
  import lila.rating.Perf.perfHandler
  import lila.rating.Glicko.glickoHandler

  private def rankSnapshot(perfs: UserPerfs): RankSnapshot =
    lila.rating.XiangqiRank.snapshot(
      perfs.rank(RankTrackId.xiangqi).getOrElse(lila.rating.XiangqiRank.initial)
    )

  def glickoField(perf: PerfKey) = s"$perf.gl"

  def byId[U: UserIdOf](u: U): Fu[UserPerfs] =
    coll.byId[UserPerfs](u.id).dmap(_ | lila.rating.UserPerfs.default(u.id))

  def idsMap[U: UserIdOf](
      u: Seq[U],
      readPref: ReadPref
  ): Fu[Map[UserId, UserPerfs]] =
    coll.idsMap[UserPerfs, UserId](u.map(_.id), none, readPref)(_.id)

  def idsMap[U: UserIdOf](u: Seq[U], pk: PerfKey, readPref: ReadPref): Fu[Map[UserId, Perf]] =
    given BSONDocumentReader[(UserId, Perf)] = lila.rating.UserPerfs.idPerfReader(pk)
    coll
      .find($inIds(u.map(_.id)), $doc(pk.value -> true).some)
      .cursor[(UserId, Perf)](readPref)
      .listAll()
      .map(_.toMap)

  def perfsOf[U: UserIdOf](u: U): Fu[UserPerfs] =
    coll.byId[UserPerfs](u.id).dmap(_ | lila.rating.UserPerfs.default(u.id))

  def perfsOf[U: UserIdOf](us: PairOf[U], primary: Boolean): Fu[PairOf[UserPerfs]] =
    val (x, y) = us
    idsMap(List(x, y), if primary then _.pri else _.sec).dmap: ps =>
      ps.getOrElse(x.id, lila.rating.UserPerfs.default(x.id)) -> ps.getOrElse(
        y.id,
        lila.rating.UserPerfs.default(y.id)
      )

  def withPerfs(u: User): Fu[UserWithPerfs] =
    perfsOf(u).dmap(UserWithPerfs(u, _))

  def withPerfs(us: PairOf[User], primary: Boolean): Fu[PairOf[UserWithPerfs]] =
    perfsOf(us, primary).dmap: (x, y) =>
      UserWithPerfs(us._1, x) -> UserWithPerfs(us._2, y)

  def withPerfs(us: Seq[User], readPref: ReadPref = _.sec): Fu[List[UserWithPerfs]] =
    idsMap(us, readPref).map: perfs =>
      us.view.map(u => lila.rating.UserWithPerfs(u, perfs.get(u.id))).toList

  def updatePerfs(prev: UserPerfs, cur: UserPerfs) =
    val perfDiff = for
      pt <- List(PerfType.Puzzle)
      if cur(pt).nb != prev(pt).nb
      bson <- summon[BSONWriter[Perf]].writeOpt(cur(pt))
    yield BSONElement(pt.key.value, bson)
    val diff = perfDiff
    diff.nonEmpty.so(coll.update.one($id(cur.id), $doc("$set" -> $doc(diff*)), upsert = true).void)

  /** Optimistic compare-and-set for one native rank account. Concurrent game completions retry from primary
    * storage instead of overwriting each other. The supplied transition must be pure.
    */
  def updateRankAtomically(
      userId: UserId,
      track: RankTrackId,
      initial: RankPerf
  )(transition: RankPerf => RankPerf): Fu[(UserPerfs, UserPerfs)] =
    val field = s"ranks.${track.value}"

    def loop(attempt: Int): Fu[(UserPerfs, UserPerfs)] =
      coll
        .byId[UserPerfs](userId)
        .flatMap: stored =>
          val previous = stored.getOrElse(lila.rating.UserPerfs.default(userId))
          val previousRank = previous.rank(track).getOrElse(initial)
          val nextRank = transition(previousRank)
          val next = previous.withRank(track, nextRank)
          if nextRank == previousRank then fuccess(previous -> next)
          else
            val expected = previous
              .rank(track)
              .fold(
                $doc(s"$field" -> $doc("$exists" -> false))
              ): rank =>
                $doc(s"$field.s" -> rank.score.value, s"$field.nb" -> rank.games)
            coll.update
              .one($id(userId) ++ expected, $set(field -> nextRank), upsert = stored.isEmpty)
              .flatMap: result =>
                if result.n == 1 then fuccess(previous -> next)
                else if attempt < 12 then loop(attempt + 1)
                else fufail(s"Could not update $track rank for $userId after concurrent writes")
              .recoverWith:
                case wr: WriteResult if isDuplicateKey(wr) && attempt < 12 => loop(attempt + 1)

    loop(0)

  def setRank(userId: UserId, track: RankTrackId, rank: RankPerf): Funit =
    coll.update.one($id(userId), $set(s"ranks.${track.value}" -> rank), upsert = true).void

  def setManagedUserInitialPerfs(id: UserId) =
    coll.update.one($id(id), lila.rating.UserPerfs.defaultManaged(id), upsert = true).void
  def setBotInitialPerfs(id: UserId) =
    coll.update.one($id(id), lila.rating.UserPerfs.defaultBot(id), upsert = true).void

  def setPerf(userId: UserId, pk: PerfKey, perf: Perf): Funit =
    coll.update.one($id(userId), $set(pk.value -> perf), upsert = true).void

  def glicko(userId: UserId, perf: PerfKey): Fu[Option[Glicko]] =
    coll
      .find($id(userId), $doc(s"$perf.gl" -> true).some)
      .one[Bdoc]
      .dmap:
        _.flatMap(_.child(perf.value))
          .flatMap(_.getAsOpt[Glicko]("gl"))

  def addPuzRun(field: String, userId: UserId, score: Int): Funit =
    coll.update
      .one(
        $id(userId),
        $inc(s"$field.runs" -> 1) ++
          $doc("$max" -> $doc(s"$field.score" -> score)),
        upsert = true
      )
      .void

  private def docPerf(doc: Bdoc, perfKey: PerfKey): Option[Perf] =
    doc.getAsOpt[Perf](perfKey.value)

  def perfOptionOf[U: UserIdOf](u: U, perfKey: PerfKey): Fu[Option[Perf]] =
    coll
      .find(
        $id(u.id),
        $doc(perfKey.value -> true).some
      )
      .one[Bdoc]
      .dmap:
        _.flatMap { docPerf(_, perfKey) }

  def perfOf[U: UserIdOf](u: U, perfKey: PerfKey): Fu[Perf] =
    perfOptionOf(u, perfKey).dmap(_ | Perf.default)

  def usingPerfOf[A, U: UserIdOf](u: U, perfKey: PerfKey)(f: Perf ?=> Fu[A]): Fu[A] =
    perfOf(u, perfKey)
      .flatMap: perf =>
        given Perf = perf
        f

  def perfOf(ids: Iterable[UserId], perfKey: PerfKey): Fu[Map[UserId, Perf]] = ids.nonEmpty.so:
    coll
      .find(
        $inIds(ids),
        $doc(perfKey.value -> true).some
      )
      .cursor[Bdoc]()
      .listAll()
      .map: docs =>
        for
          doc <- docs
          id <- doc.getAsOpt[UserId]("_id")
          perf <- docPerf(doc, perfKey)
        yield id -> perf
      .map: pairs =>
        val h = pairs.toMap
        ids.map(id => id -> h.getOrElse(id, Perf.default)).toMap

  def perfsOf(ids: Iterable[UserId]): Fu[Map[UserId, UserPerfs]] = ids.nonEmpty.so:
    coll.find($inIds(ids)).cursor[UserPerfs]().listAll().map(_.mapBy(_.id))

  def withPerf(users: List[User], perfKey: PerfKey): Fu[List[WithPerf]] =
    idsMap(users, _.sec).map: allPerfs =>
      users.map: user =>
        val perfs = allPerfs.getOrElse(user.id, lila.rating.UserPerfs.default(user.id))
        WithPerf(user, perfs(perfKey), rankSnapshot(perfs).some)

  def withPerf(user: User, perfKey: PerfKey): Fu[WithPerf] =
    perfsOf(user).dmap: perfs =>
      WithPerf(user, perfs(perfKey), rankSnapshot(perfs).some)

  def withPerf(us: PairOf[User], perfKey: PerfKey, readPref: ReadPref): Fu[PairOf[WithPerf]] =
    idsMap(List(us._1, us._2), readPref).dmap: allPerfs =>
      def one(user: User) =
        val perfs = allPerfs.getOrElse(user.id, lila.rating.UserPerfs.default(user.id))
        WithPerf(user, perfs(perfKey), rankSnapshot(perfs).some)
      one(us._1) -> one(us._2)

  def perfOf[U: UserIdOf](us: PairOf[U], perfKey: PerfKey, readPref: ReadPref): Fu[PairOf[Perf]] =
    val (x, y) = us
    idsMap(List(x, y), perfKey, readPref).dmap: ps =>
      ps.getOrElse(x.id, Perf.default) -> ps.getOrElse(y.id, Perf.default)

  def perfOf(userId: UserId, pk: PerfKey): Fu[Perf] =
    coll
      .find($id(userId), $doc(pk.value -> true).some)
      .one[Bdoc]
      .dmap:
        _.flatMap(_.getAsOpt[Perf](pk.value)).getOrElse(Perf.default)

  def intRatingOf(userId: UserId, pk: PerfKey): Fu[IntRating] =
    perfOf(userId, pk).map(_.intRating)

  def dubiousPuzzle(
      @annotation.unused id: UserId,
      @annotation.unused puzzle: Perf
  ): Fu[Boolean] = fuccess(false)

  object aggregate:
    val lookup = $lookup.simple(coll, "perfs", "_id", "_id")

    def lookup(pk: PerfKey): Bdoc =
      val pipe = List($doc("$project" -> $doc(pk.value -> true, "ranks" -> true)))
      $lookup.simple(coll, "perfs", "_id", "_id", pipe)

    def readFirst[U: UserIdOf](root: Bdoc, u: U): UserPerfs =
      root
        .getAsOpt[List[UserPerfs]]("perfs")
        .flatMap(_.headOption)
        .getOrElse(lila.rating.UserPerfs.default(u.id))

    def readFirst(root: Bdoc, pk: PerfKey): Perf = (for
      perfs <- root.getAsOpt[List[Bdoc]]("perfs")
      perfs <- perfs.headOption
      perf <- perfs.getAsOpt[Perf](pk.value)
    yield perf).getOrElse(Perf.default)

    def readRank(root: Bdoc): RankSnapshot =
      val rank = for
        perfs <- root.getAsOpt[List[Bdoc]]("perfs")
        doc <- perfs.headOption
        ranks <- doc.getAsOpt[BSONDocument]("ranks")
        rankDoc <- ranks.getAsOpt[BSONDocument](RankTrackId.xiangqi.value)
        rank <- rankDoc.asOpt[RankPerf]
      yield rank
      lila.rating.XiangqiRank.snapshot(rank.getOrElse(lila.rating.XiangqiRank.initial))

    def readFrom[U: UserIdOf](doc: Bdoc, u: U): UserPerfs =
      doc.asOpt[UserPerfs].getOrElse(lila.rating.UserPerfs.default(u.id))

  export aggregate.{ lookup as aggregateLookup, readFirst as aggregateReadFirst }
