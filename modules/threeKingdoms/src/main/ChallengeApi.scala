package lila.threeKingdoms

import scalalib.actor.AsyncActorSequencers
import reactivemongo.api.bson.*
import lila.db.dsl.{ *, given }
import lila.core.notify.{ NotificationContent, PrefEvent }

final case class KingdomChallenge(
    @Macros.Annotations.Key("_id") id: GameId,
    creator: UserId,
    users: Vector[UserId],
    accepted: Set[UserId],
    config: ClockConfig,
    createdAt: Instant,
    expiresAt: Instant,
    status: String = "pending",
    revision: Int = 0,
    notifyPending: Boolean = true,
    botLevel: Option[Int] = None,
    creatorSide: Option[Kingdom] = None,
    openSeek: Option[Boolean] = None,
    ranked: Option[Boolean] = None
):
  def claimSeat(user: UserId): KingdomChallenge =
    val humans = users :+ user
    copy(
      users = humans,
      accepted = accepted + user,
      revision = revision + 1,
      status = if humans.size + botLevel.size == 3 then "starting" else "pending"
    )

  def correspondenceRanked = config.days.isDefined && botLevel.isEmpty
  def intendsRank = ranked.contains(true) || correspondenceRanked
  def source = if openSeek.contains(true) then "seek" else "friend"

  def arrangeSeats[A](humans: Vector[A])(bot: Int => A): Vector[A] =
    val botSeat = Math.floorMod(id.value.hashCode, 3)
    val seats = botLevel.fold(humans)(level => humans.patch(botSeat, Vector(bot(level)), 0))
    creatorSide.fold(seats): kingdom =>
      val index = users.indexOf(creator)
      val from = if botLevel.isDefined && botSeat <= index then index + 1 else index
      val to = kingdom.ordinal
      seats.updated(to, seats(from)).updated(from, seats(to))

final class ChallengeApi(
    coll: Coll,
    maker: GameMaker,
    users: lila.user.UserApi,
    granter: lila.challenge.ChallengeGranter,
    relations: lila.core.relation.RelationApi,
    notifyApi: lila.notify.NotifyApi,
    mayPlayRatedFriend: lila.core.pool.MayPlayRatedFriend,
    repo: GameRepo,
    participation: lila.core.pool.PoolParticipation
)(using Executor, Scheduler):
  import BSONHandlers.given
  private given BSONDocumentHandler[KingdomChallenge] = Macros.handler
  private val queue = AsyncActorSequencers[GameId](
    Max(16),
    5.minutes,
    10.seconds,
    "threeKingdoms.challenge",
    lila.mon.asyncActorMonitor.highCardinality
  )

  def byId(id: GameId): Fu[Option[KingdomChallenge]] = coll.byId[KingdomChallenge](id)
  def removeByUser(user: UserId): Funit =
    coll.update
      .one(
        $doc("users" -> user, "status" -> $doc("$in" -> List("pending", "starting"))),
        $set("status" -> "cancelled", "notifyPending" -> false) ++ $inc("revision" -> 1),
        multi = true
      )
      .void
  def forUser(user: UserId): Fu[List[KingdomChallenge]] =
    coll
      .find($doc("users" -> user, "status" -> "pending", "expiresAt" -> $doc("$gt" -> nowInstant)))
      .sort($sort.desc("createdAt"))
      .cursor[KingdomChallenge]()
      .list(20)

  def create(
      creator: User,
      opponents: Vector[UserId],
      config: ClockConfig,
      botLevel: Option[Int],
      creatorSide: Option[Kingdom] = None,
      publicSeek: Boolean = false,
      rated: Boolean = false
  ): Fu[Either[String, KingdomChallenge]] =
    val humans = opponents :+ creator.id
    val liveRated = rated && config.days.isEmpty
    if liveRated && (botLevel.nonEmpty || creatorSide.nonEmpty || publicSeek || config != ClockConfig()) then
      fuccess(Left("invalidClock"))
    else if botLevel.exists(level => level < 1 || level > 5) then fuccess(Left("invalidLevel"))
    else if publicSeek && (opponents.nonEmpty || config.days.isEmpty) then fuccess(Left("invalidClock"))
    else if !publicSeek && (humans.size + botLevel.size != 3 || humans.distinct.size != humans.size) then
      fuccess(Left("chooseTwoDifferentPlayers"))
    else
      val id = GameId(scalalib.SecureRandom.nextString(GameId.size))
      val now = nowInstant
      val challenge = KingdomChallenge(
        id,
        creator.id,
        scala.util.Random.shuffle(humans),
        Set(creator.id),
        config,
        now,
        now.plusSeconds(if config.realTime then 600 else 14 * 86400),
        botLevel = botLevel,
        creatorSide =
          if publicSeek then creatorSide.orElse(Some(scala.util.Random.shuffle(Kingdom.values.toList).head))
          else creatorSide,
        ranked = Option.when(liveRated)(true),
        openSeek = Option.when(publicSeek)(true),
        notifyPending = !publicSeek
      )
      allowed(challenge).flatMap:
        case false => fuccess(Left("challengeNotAllowed"))
        case true =>
          coll.insert
            .one(challenge)
            .flatMap: _ =>
              if publicSeek then funit
              else
                queue(id)(deliver(challenge)).recover { case e =>
                  logger.error("Invitation delivery will be retried", e)
                }
            .inject(Right(challenge))

  def publicOffers(user: Option[UserId]): Fu[List[KingdomChallenge]] =
    val pending = $doc("openSeek" -> true, "status" -> "pending", "expiresAt" -> $doc("$gt" -> nowInstant))
    def list(selector: BSONDocument) = coll
      .find(pending ++ selector)
      .sort($sort.desc("createdAt"))
      .cursor[KingdomChallenge]()
      .list(50)
    user.fold(list($doc())): id =>
      list($doc("users" -> id)).zip(list($doc("users" -> $doc("$ne" -> id)))).map { case (mine, others) =>
        mine ++ others
      }

  def join(id: GameId, user: UserId): Fu[Either[String, KingdomChallenge]] = queue(id):
    byId(id).flatMap:
      case Some(c) if c.openSeek.contains(true) && c.status == "pending" && c.expiresAt.isAfter(nowInstant) =>
        if c.users.contains(user) then fuccess(Right(c))
        else
          val next = c.claimSeat(user)
          allowed(next).flatMap:
            case false => fuccess(Left("challengeNotAllowed"))
            case true =>
              coll.update
                .one($id(id) ++ $doc("revision" -> c.revision), next)
                .flatMap: result =>
                  if result.n != 1 then fuccess(Left("staleRevision"))
                  else if next.status == "starting" then start(next).map(Right(_))
                  else fuccess(Right(next))
      case _ => fuccess(Left("challengeUnavailable"))

  def answer(id: GameId, user: UserId, accept: Boolean): Fu[Either[String, KingdomChallenge]] = queue(id):
    byId(id).flatMap:
      case Some(c) if c.users.contains(user) && c.status == "started" => fuccess(Right(c))
      case Some(c) if c.users.contains(user) && c.status == "pending" && c.expiresAt.isAfter(nowInstant) =>
        (if accept then allowed(c) else fuTrue).flatMap: permitted =>
          val accepted = if accept && permitted then c.accepted + user else c.accepted
          val next = c.copy(
            accepted = accepted,
            revision = c.revision + 1,
            status = if !permitted then "cancelled"
            else if !accept then "declined"
            else if c.users.size + c.botLevel.size == 3 && c.users.forall(accepted.contains) then "starting"
            else "pending"
          )
          coll.update
            .one($id(id) ++ $doc("revision" -> c.revision), next)
            .flatMap: result =>
              if result.n != 1 then fuccess(Left("staleRevision"))
              else
                notifyApi.markRead(
                  user,
                  $doc("content.type" -> "threeKingdomsChallenge", "content.gameId" -> id)
                ) >>
                  (if next.status == "starting" then start(next).map(Right(_)) else fuccess(Right(next)))
      case _ => fuccess(Left("challengeUnavailable"))

  private def start(c: KingdomChallenge): Fu[KingdomChallenge] =
    val expectedSeats = c.arrangeSeats(c.users.map(id => (Some(id): Option[UserId]) -> Option.empty[Int]))(
      level => None -> Some(level)
    )
    // Recover a game already inserted before a crash even if a later preference changed.
    maker
      .existing(c.id)
      .flatMap:
        case Some(g)
            if g.seats.map(s => s.userId -> s.aiLevel) == expectedSeats && g.source == c.source &&
              g.clock.config == c.config && g.rated == c.intendsRank =>
          finishStart(c)
        case Some(_) => fufail("Three Kingdoms challenge game does not match its invitation")
        case None =>
          allowed(c).flatMap:
            case available
                if !available || (!c.correspondenceRanked && c.ranked
                  .contains(true) && !participation.reserveChallenge(c.users.toList, c.id, nowMillis)) =>
              val cancelled = c.copy(status = "cancelled", revision = c.revision + 1, notifyPending = false)
              coll.update.one($id(c.id), cancelled).inject(cancelled)
            case _ =>
              maker
                .seats(c.users, c.correspondenceRanked)
                .flatMap(humans =>
                  maker.create(
                    c.arrangeSeats(humans)(level => Seat(None, Some(level), None)),
                    c.config,
                    c.source,
                    c.id,
                    ratedFriend = c.intendsRank
                  )
                )
                .recoverWith:
                  case e if c.intendsRank =>
                    maker
                      .existing(c.id)
                      .flatMap: persisted =>
                        if persisted.isEmpty then participation.release(c.id, c.users)
                        fufail(e)
                .flatMap(_ => finishStart(c))

  private def finishStart(c: KingdomChallenge): Fu[KingdomChallenge] =
    val started = c.copy(status = "started", revision = c.revision + 1, notifyPending = true)
    coll.update
      .one($id(c.id) ++ $doc("status" -> "starting"), started)
      .flatMap: _ =>
        deliver(started)
          .recover { case e => logger.error("Game-ready notification will be retried", e) }
          .inject(started)

  private def allowed(c: KingdomChallenge): Fu[Boolean] =
    users
      .enabledByIds(c.users.toList)
      .flatMap: accounts =>
        if accounts.size != c.users.size || accounts.exists(_.isBot) then fuFalse
        else
          given Option[Me] = accounts.find(_.id == c.creator).map(Me(_))
          for
            grants <- accounts
              .filterNot(a => c.openSeek.contains(true) || a.id == c.creator)
              .traverse(granter.mayChallenge)
            relations <- c.users
              .combinations(2)
              .filter(_.size == 2)
              .toList
              .traverse(pair => this.relations.fetchRelations(pair(0), pair(1)))
            eligible <-
              if !c.intendsRank then fuTrue
              else if !accounts.forall(u => u.rankable && !u.lame) then fuFalse
              else if c.correspondenceRanked then fuTrue
              else
                for
                  seats <- maker.seats(c.users, c.correspondenceRanked)
                  eligible <- accounts.traverse(mayPlayRatedFriend.exec).map(_.forall(identity))
                  repeated <- c.users.traverse(repo.repeatedRatedOpponents)
                yield eligible && repeated.forall(avoid => !c.users.exists(avoid)) &&
                  seats.flatMap(_.rank).map(_.matchingGroup).combinations(2).forall {
                    case Vector(a, b) => (a - b).abs <= 1
                    case _ => true
                  }
          yield eligible && grants.forall(identity) && relations.forall(r =>
            !List(r.in, r.out).flatten.contains(lila.core.relation.Relation.Block)
          )

  private def deliver(c: KingdomChallenge): Funit =
    val started = c.status == "started"
    val targets = if started then c.users else c.users.filterNot(_ == c.creator)
    targets.traverse_(target =>
      notifyApi.notifyOneForEvent(
        target,
        NotificationContent.ThreeKingdomsChallenge(c.creator, c.id, started),
        PrefEvent.challenge
      )
    ) >>
      coll.update.one($id(c.id), $set("notifyPending" -> false)).void

  // Recover the narrow crash window between unanimous acceptance and game insertion.
  def recover(): Funit = coll
    .find(
      $or(
        $doc("status" -> "starting"),
        $doc(
          "status" -> $doc("$in" -> List("pending", "started")),
          "notifyPending" -> true,
          "expiresAt" -> $doc("$gt" -> nowInstant)
        )
      )
    )
    .cursor[KingdomChallenge]()
    .list(20)
    .flatMap(
      _.traverse_(c =>
        queue(c.id):
          byId(c.id).flatMap:
            case Some(current) if current.status == "starting" => start(current).void
            case Some(current)
                if current.notifyPending && Set("pending", "started").contains(current.status) =>
              deliver(current)
            case _ => funit
      )
    )
