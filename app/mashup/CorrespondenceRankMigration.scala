package lila.app
package mashup

import scala.collection.mutable
import scala.concurrent.Await
import reactivemongo.api.{ AsyncDriver, DB, MongoConnection, WriteConcern }
import reactivemongo.api.bson.*
import lila.core.rank.{ RankPerf, RankSnapshot, RankTrackId }
import lila.db.dsl.{ *, given }
import lila.rating.{ RankPolicy, ThreeKingdomsRank }
import lila.rating.UserPerfs.rankPerfHandler
import lila.threeKingdoms.{ Kingdom, KingdomGame, Position }

/** Offline entry point for the November 2026 rollout. Uses the application's game codecs, catalogues,
  * settlement policy and account encoding. Run with writers stopped; apply publishes one transaction.
  */
object CorrespondenceRankMigration:
  private val marker = "correspondence_ranks_v1"
  private given Executor = scala.concurrent.ExecutionContext.global
  private def await[A](future: Fu[A]): A = Await.result(future, 60.seconds)

  def main(args: Array[String]): Unit =
    require(
      args.length == 3 && Set("preview", "apply")(args(0)),
      "Expected preview|apply, Mongo URI, database"
    )
    val driver = new AsyncDriver()
    try
      val conn = await(MongoConnection.fromString(args(1)).flatMap(driver.connect(_)))
      run(await(conn.database(args(2))), args(0) == "apply")
    finally await(driver.close())

  private case class Entry(
      id: GameId,
      users: List[UserId],
      track: RankTrackId,
      start: Instant,
      end: Option[Instant],
      game: Either[lila.core.game.Game, KingdomGame]
  )

  private case class Patch(collection: String, id: String, fields: Bdoc, upsert: Boolean = false)

  def run(db: DB, applyWrites: Boolean): Unit =
    import lila.game.BSONHandlers.gameHandler
    import lila.threeKingdoms.BSONHandlers.given
    import lila.user.BSONHandlers.given
    def coll(n: String): Coll = db.collection(n)
    def docs(n: String, selector: Bdoc) = await(coll(n).find(selector).cursor[Bdoc]().listAll())
    if await(coll("schema_migration").exists($id(marker) ++ $doc("state" -> "complete"))) then
      println("Correspondence rank replay already complete")
      return
    val counts = mutable.Map.empty[String, Int].withDefaultValue(0)
    def count(reason: String): Unit = counts.update(reason, counts(reason) + 1)
    val members = mutable.Map.empty[UserId, Option[lila.core.user.User]]
    def member(id: UserId) = members.getOrElseUpdate(
      id,
      await(
        coll("user4")
          .find(
            $id(id),
            Some(
              $doc(
                "username" -> true,
                "count" -> true,
                "enabled" -> true,
                "title" -> true,
                "createdAt" -> true,
                "marks" -> true
              )
            )
          )
          .one[lila.core.user.User]
      )
    )
    def eligible(ids: List[UserId], n: Int) = ids.distinct.size == n &&
      ids.forall(id => member(id).exists(u => u.rankable && !u.lame))
    val duels = docs("game5", $doc("cd" -> $doc("$gt" -> 0))).flatMap: doc =>
      val g = gameHandler.readTry(doc).get
      val track = RankTrackId.forMode(RankTrackId.of(g.nativeVariant), true)
      require(g.rankTrack.isEmpty, "Found ranked correspondence game without a completed migration marker")
      val reason =
        if g.hasAi || !eligible(g.userIds, 2) then Some("ineligible seats")
        else if g.hasClock || g.moveTimeLimit.isDefined || g.fromPosition || g.metadata.rules.nonEmpty ||
          g.metadata.pgnImport.isDefined || !lila.core.game.RankedGame
            .hasRankedStart(g.xiangqi, correspondence = true) ||
          !g.source.exists(lila.core.game.RankedGame.correspondenceSource)
        then Some("custom or ineligible source")
        else if g.aborted || g.status == chess.Status.NoStart || (g.finished && g.playedPlies < 2) then
          Some("ineligible result")
        else None
      count(s"${track.value} ${reason.getOrElse(if g.finished then "finished" else "ongoing")}")
      reason.isEmpty.option(
        Entry(
          g.id,
          g.userIds,
          track,
          g.createdAt,
          g.finished.option(g.completedAt.getOrElse(g.movedAt)),
          Left(g)
        )
      )
    val kingdoms = docs("three_kingdoms_game", $doc("clock.config.days" -> $doc("$gt" -> 0))).flatMap: doc =>
      val g = summon[BSONDocumentReader[KingdomGame]].readTry(doc).get
      require(!g.rated, "Found ranked correspondence Kingdoms game without migration marker")
      val valid =
        eligible(g.userIds, 3) && Set("friend", "seek")(g.source) && g.initial == Position.initial &&
          (!g.position.finished || g.events.size >= 2)
      count(s"threeKingdoms ${
          if !valid then "ineligible" else if g.position.finished then "finished" else "ongoing"
        }")
      valid.option(
        Entry(g.id, g.userIds, g.accountTrack, g.createdAt, g.position.finished.option(g.movedAt), Right(g))
      )
    val entries = duels ++ kingdoms
    val accounts = mutable.Map.empty[(UserId, RankTrackId), RankPerf]
    val history = mutable.Map.empty[(UserId, RankTrackId), Bdoc]
    val snapshots = mutable.Map.empty[Entry, List[RankSnapshot]]
    val events = entries.flatMap(e => (e.start, false, e) :: e.end.map((_, true, e)).toList)
    events
      .sortBy((at, finish, e) => (at, finish, e.id.value))
      .foreach: (at, finish, e) =>
        val policy = RankPolicy(e.track)
        val before = e.users.map(id => accounts.getOrElse(id -> e.track, policy.initial))
        if !finish then snapshots(e) = before.map(p => policy.snapshot(p).copy(track = e.track))
        else
          val start = snapshots(e)
          if start.map(_.matchingGroup).max - start.map(_.matchingGroup).min > 1 then count("wide rank gap")
          val results = e.game match
            case Left(g) =>
              val outcome = g.outcome.get
              val favored = g.winnerColor.orElse(
                Option.when(
                  g.status == chess.Status.Draw &&
                    start.head.score != start.last.score
                )(chess.Color.fromWhite(start.head.score.value < start.last.score.value))
              )
              val suppressed = favored.exists: color =>
                val i = if color.white then 0 else 1
                lila.round.FarmBoostDetection.needsRelationCheck(
                  g,
                  member(e.users(i)).get.createdAt,
                  at,
                  before(i).games
                ) &&
                (g.sourceIs(_.Friend) || await(
                  lila.security.SessionStore.shareAnIpOrFp(coll("security"), e.users.head -> e.users.last)
                ))
              if suppressed then
                count("settlement withheld by existing policy")
                Nil
              else
                val delta = policy.settle(start.head, start.last, outcome).fold(sys.error, identity)
                List(delta.red, delta.black)
                  .zip(chess.Color.all)
                  .map((d, c) => (d, outcome.winner.contains(c), outcome.winner.isEmpty))
            case Right(g) =>
              val places = Kingdom.values.toVector.map(k => g.position.placement(k).get)
              ThreeKingdomsRank
                .settleThree(start.toVector, places)
                .fold(sys.error, identity)
                .zipWithIndex
                .map: (d, i) =>
                  (
                    d,
                    places(i) == 1d,
                    g.position.ending.exists(x => x.draw && x.winners.contains(Kingdom.values(i)))
                  )
                .toList
          if results.nonEmpty then
            snapshots(e) = results.zipWithIndex.map: (r, i) =>
              val key = e.users(i) -> e.track
              val next = policy.applyResult(before(i), r._1, r._2, r._3, at, e.id)
              accounts(key) = next
              val day = at.toString.take(10)
              history(key) = (history.getOrElse(key, $empty) -- day) ++ $doc(day -> next.score.value)
              start(i).copy(diff = next.settlement(e.id), after = Some(policy.catalog.code(next.score)))
    val games = entries.map: e =>
      val seats = snapshots(e)
      e.game match
        case Left(_) =>
          Patch(
            "game5",
            e.id.value,
            $doc(
              "rt" -> e.track.value,
              "ra" -> true,
              "p0.rk" -> lila.game.Player.rankWrite(seats.head),
              "p1.rk" -> lila.game.Player.rankWrite(seats.last)
            )
          )
        case Right(g) =>
          Patch(
            "three_kingdoms_game",
            e.id.value,
            $doc("rated" -> true, "seats" -> g.seats.zip(seats).map((s, r) => s.copy(rank = Some(r))))
          )
    val perfs = accounts.toList.map: (key, perf) =>
      val (user, track) = key
      val field = s"ranks.${track.value}"
      require(
        !await(coll("user_perf").exists($id(user) ++ $doc(field -> $doc("$exists" -> true)))),
        "Unexpected pre-existing correspondence account"
      )
      require(history(key).elements.toList.sortBy(_.name).last.value.asOpt[Int].contains(perf.score.value))
      Patch("user_perf", user.value, $doc(field -> perf, s"rankHistory.${track.value}" -> history(key)), true)
    val counters = entries
      .filter(_.end.isDefined)
      .flatMap(_.users)
      .groupMapReduce(identity)(_ => 1)(_ + _)
      .map: (user, additional) =>
        val duels = await(
          coll("game5")
            .countSel(lila.game.Query.ranked(user) ++ $doc("s" -> $doc("$gte" -> chess.Status.Mate.id)))
        )
        val kingdoms = await(
          coll("three_kingdoms_game").countSel($doc("users" -> user, "rated" -> true, "finished" -> true))
        )
        Patch("user4", user.value, $doc("count.rated" -> (duels + kingdoms + additional)))
    val patches = games ++ perfs ++ counters
    counts.toList.sorted.foreach((key, n) => println(s"$key: $n"))
    println(s"${entries.size} games, ${accounts.size} correspondence accounts, ${patches.size} updates")
    if applyWrites then
      val session = await(db.startSession())
      try
        val tx = await(
          session.startTransaction(
            Some(WriteConcern(WriteConcern.Majority, j = true, fsync = false, wtimeout = Some(10000)))
          )
        )
        patches.foreach: p =>
          val target: Coll = tx.collection(p.collection)
          val result = await(target.update.one($id(p.id), $doc("$set" -> p.fields), upsert = p.upsert))
          require(result.n == 1, "Migration update did not match one document")
        patches.foreach: p =>
          val target: Coll = tx.collection(p.collection)
          require(
            await(target.find($id(p.id) ++ p.fields, Some($doc("_id" -> true))).one[Bdoc]).isDefined,
            "Migration verification failed"
          )
        val markers: Coll = tx.collection("schema_migration")
        await(
          markers.insert.one(
            $id(marker) ++ $doc("state" -> "complete", "games" -> entries.size, "at" -> nowInstant)
          )
        )
        await(tx.commitTransaction())
      finally await(session.endSession())
