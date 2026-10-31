package lila.threeKingdoms

import lila.db.dsl.{ *, given }
import reactivemongo.pekkostream.{ PekkoStreamCursor, cursorProducer }

final class GameRepo(val coll: Coll)(using Executor):
  import BSONHandlers.given
  def byId(id: GameId): Fu[Option[KingdomGame]] = coll.byId[KingdomGame](id)
  def byIds(ids: Seq[GameId]): Fu[List[KingdomGame]] =
    if ids.isEmpty then fuccess(Nil) else coll.byOrderedIds[KingdomGame, GameId](ids)(_.id)

  def historySelector(user: UserId, filter: String, opponent: Option[UserId] = None): Bdoc =
    $doc("users" -> user) ++ (filter match
      case "ranked" => $doc("rated" -> true)
      case "win" => $doc("winners" -> user)
      case "loss" => $doc("losers" -> user)
      case "draw" => $doc("draws" -> user)
      case "playing" => $doc("playingUsers" -> user)
      case "me" => $doc("users" -> $doc("$all" -> (user :: opponent.toList).distinct))
      case _ => $empty)
  def insert(game: KingdomGame): Funit = coll.insert.one(game).void
  def save(previous: KingdomGame, next: KingdomGame): Fu[Boolean] =
    val fields = summon[reactivemongo.api.bson.BSONDocumentWriter[KingdomGame]].writeTry(next).get -- "_id"
    // Preserve independently owned delivery receipts when game state advances.
    val update = $doc("$set" -> fields) ++
      (if next.deadline.isEmpty then $doc("$unset" -> $doc("deadline" -> true)) else $empty)
    coll.update.one($id(previous.id) ++ $doc("revision" -> previous.revision), update).map(_.n == 1)
  def history(
      user: Option[UserId],
      before: Option[(Instant, GameId)],
      limit: Int = 20
  ): Fu[List[KingdomGame]] =
    coll
      .find(
        user.fold($empty)(id => $doc("users" -> id)) ++
          before.fold($empty) { (at, id) =>
            $doc(
              "$or" -> $arr(
                $doc("createdAt" -> $doc("$lt" -> at)),
                $doc("createdAt" -> at, "_id" -> $doc("$lt" -> id))
              )
            )
          }
      )
      .sort($doc("createdAt" -> -1, "_id" -> -1))
      .cursor[KingdomGame](ReadPref.sec)
      .list(limit.max(1).min(100))
  def countPlaying(user: UserId): Fu[Int] = coll.countSel($doc("playingUsers" -> user))
  def activeFor(user: UserId): Fu[List[KingdomGame]] =
    coll.find($doc("playingUsers" -> user)).sort($sort.desc("createdAt")).cursor[KingdomGame]().list(20)
  def countWith(a: UserId, b: UserId): Fu[Int] =
    coll.countSel($doc("users" -> $doc("$all" -> List(a, b).distinct)))

  def recentActivity(user: UserId): Fu[List[(Instant, lila.core.rating.Score)]] =
    coll
      .aggregateList(7, _.sec): framework =>
        import framework.*
        def result(field: String) = Sum($doc("$cond" -> $arr($doc("$in" -> $arr(user, s"$$$field")), 1, 0)))
        Match($doc("users" -> user, "finished" -> true)) -> List(
          Group($doc("$dateTrunc" -> $doc("date" -> "$movedAt", "unit" -> "day")))(
            "win" -> result("winners"),
            "loss" -> result("losers"),
            "draw" -> result("draws")
          ),
          Sort(Descending("_id")),
          Limit(7)
        )
      .map(
        _.flatMap(d =>
          d.getAsOpt[Instant]("_id")
            .map(at =>
              at -> lila.core.rating.Score(
                d.int("win").getOrElse(0),
                d.int("loss").getOrElse(0),
                d.int("draw").getOrElse(0),
                None
              )
            )
        )
      )

  def exportUser(user: UserId, from: Option[Instant] = None, until: Option[Instant] = None)(using
      org.apache.pekko.stream.Materializer
  ): org.apache.pekko.stream.scaladsl.Source[KingdomGame, ?] =
    coll
      .find($doc("users" -> user) ++ (if from.nonEmpty || until.nonEmpty then
                                        $doc(
                                          "createdAt" -> (from.fold($empty)(at => $doc("$gte" -> at)) ++ until
                                            .fold($empty)(at => $doc("$lt" -> at)))
                                        )
                                      else $empty))
      .sort($sort.asc("createdAt"))
      .cursor[KingdomGame](ReadPref.sec)
      .documentSource()
  def playing(user: UserId): Fu[List[KingdomGame]] =
    coll
      .find($doc("users" -> user, "finished" -> false))
      .sort($sort.desc("createdAt"))
      .cursor[KingdomGame]()
      .list(20)
  def live: Fu[List[KingdomGame]] =
    coll
      .find($doc("finished" -> false))
      .sort($sort.desc("movedAt"))
      .cursor[KingdomGame](ReadPref.sec)
      .list(20)
  def expired(now: Long): Fu[List[KingdomGame]] =
    coll
      .find($doc("finished" -> false, "deadline" -> $doc("$lte" -> now)))
      .sort($sort.asc("deadline"))
      .cursor[KingdomGame]()
      .list(100)
  def unattendedDuels: Fu[List[KingdomGame]] =
    coll.find($doc("unattendedDuel" -> true)).sort($sort.asc("movedAt")).cursor[KingdomGame]().list(4)
  def unsettled: Fu[List[KingdomGame]] =
    coll
      .find($doc("finished" -> true, "settled" -> false))
      .sort($sort.asc("movedAt"))
      .cursor[KingdomGame]()
      .list(50)
  def recentOpponents(user: UserId, since: Instant): Fu[List[KingdomGame]] =
    coll
      .find($doc("users" -> user, "rated" -> true, "createdAt" -> $doc("$gt" -> since)))
      .sort($sort.desc("createdAt"))
      .cursor[KingdomGame]()
      .list(20)

  def tournamentGames(
      id: TourId,
      user: Option[UserId] = None,
      playingOnly: Boolean = false,
      limit: Int = 20
  ): Fu[List[KingdomGame]] =
    coll
      .find(
        $doc("tournamentId" -> id) ++ user.fold($empty)(u => $doc("users" -> u)) ++
          (if playingOnly then $doc("finished" -> false) else $empty)
      )
      .sort($sort.desc("createdAt"))
      .cursor[KingdomGame]()
      .list(limit)

  def tournamentCount(id: TourId): Fu[Int] = coll.countSel($doc("tournamentId" -> id))
  def tournamentExport(id: TourId, user: Option[UserId])(using
      org.apache.pekko.stream.Materializer
  ): org.apache.pekko.stream.scaladsl.Source[KingdomGame, ?] =
    coll
      .find($doc("tournamentId" -> id) ++ user.fold($empty)(u => $doc("users" -> u)))
      .sort($sort.asc("createdAt"))
      .cursor[KingdomGame](ReadPref.sec)
      .documentSource()
  def unrecordedTournament(id: TourId): Fu[List[KingdomGame]] =
    coll
      .find($doc("tournamentId" -> id, "finished" -> true, "tournamentRecorded" -> $doc("$ne" -> true)))
      .cursor[KingdomGame]()
      .list(100)
  def recordTournamentResult(id: GameId): Funit =
    coll.update.one($id(id), $set("tournamentRecorded" -> true)).void
  def voidTournamentMatches(id: TourId, user: UserId): Funit =
    coll.update
      .one($doc("tournamentId" -> id, "users" -> user), $set("tournamentVoid" -> true), multi = true)
      .void

  // Score sheets and pairing history never read the potentially large action log.
  def tournamentResults(
      id: TourId,
      user: Option[UserId] = None,
      until: Option[Instant] = None,
      recent: Option[Int] = None,
      playingOnly: Boolean = false
  ): Fu[List[TournamentResult]] =
    coll
      .find(
        $doc("tournamentId" -> id) ++ user.fold($empty)(u => $doc("users" -> u)) ++
          until.fold($empty)(at =>
            $doc("finished" -> true, "tournamentVoid" -> $doc("$ne" -> true), "movedAt" -> $doc("$lte" -> at))
          ) ++
          (if playingOnly then $doc("finished" -> false) else $empty),
        Some($doc("users" -> true, "position" -> true, "createdAt" -> true, "movedAt" -> true))
      )
      .sort($sort.desc("createdAt"))
      .cursor[Bdoc]()
      .list(recent.getOrElse(Int.MaxValue))
      .map:
        _.reverse.map: d =>
          TournamentResult(
            d.getAsOpt[GameId]("_id").get,
            d.getAsOpt[Vector[UserId]]("users").get,
            d.getAsOpt[Position]("position").get,
            d.getAsOpt[Instant]("createdAt").get,
            d.getAsOpt[Instant]("movedAt").get
          )

final case class TournamentResult(
    id: GameId,
    users: Vector[UserId],
    position: Position,
    createdAt: Instant,
    movedAt: Instant
):
  def points(user: UserId): Option[Int] =
    Option
      .when(position.finished)(users.indexOf(user))
      .filter(_ >= 0)
      .flatMap(i => position.placement(Kingdom.values(i)))
      .map(place => ((3d - place) * 2).toInt)
