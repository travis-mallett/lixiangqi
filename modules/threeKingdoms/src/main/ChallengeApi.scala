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
    notifyPending: Boolean = true
)

final class ChallengeApi(
    coll: Coll,
    maker: GameMaker,
    users: lila.user.UserApi,
    granter: lila.challenge.ChallengeGranter,
    relations: lila.core.relation.RelationApi,
    notifyApi: lila.notify.NotifyApi
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
      config: ClockConfig
  ): Fu[Either[String, KingdomChallenge]] =
    if opponents.size != 2 || (opponents :+ creator.id).distinct.size != 3 then
      fuccess(Left("chooseTwoDifferentPlayers"))
    else
      val id = GameId(scalalib.SecureRandom.nextString(GameId.size))
      val now = nowInstant
      val challenge = KingdomChallenge(
        id,
        creator.id,
        scala.util.Random.shuffle(opponents :+ creator.id),
        Set(creator.id),
        config,
        now,
        now.plusSeconds(600)
      )
      allowed(challenge).flatMap:
        case false => fuccess(Left("challengeNotAllowed"))
        case true =>
          coll.insert
            .one(challenge)
            .flatMap: _ =>
              queue(id)(deliver(challenge)).recover { case e =>
                logger.error("Invitation delivery will be retried", e)
              }
            .inject(Right(challenge))

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
            else if accepted.size == 3 then "starting"
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
    // Recover a game already inserted before a crash even if a later preference changed.
    maker
      .existing(c.id)
      .flatMap:
        case Some(g) if g.userIds == c.users.toList && g.source == "friend" && g.clock.config == c.config =>
          finishStart(c)
        case Some(_) => fufail("Three Kingdoms challenge game does not match its invitation")
        case None =>
          allowed(c).flatMap:
            case false =>
              val cancelled = c.copy(status = "cancelled", revision = c.revision + 1, notifyPending = false)
              coll.update.one($id(c.id), cancelled).inject(cancelled)
            case true =>
              maker
                .seats(c.users)
                .flatMap(maker.create(_, c.config, "friend", c.id))
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
        if accounts.size != 3 || accounts.exists(_.isBot) then fuFalse
        else
          given Option[Me] = accounts.find(_.id == c.creator).map(Me(_))
          for
            grants <- accounts.filterNot(_.id == c.creator).traverse(granter.mayChallenge)
            relations <- c.users
              .combinations(2)
              .toList
              .traverse(pair => this.relations.fetchRelations(pair(0), pair(1)))
          yield grants.forall(identity) && relations.forall(r =>
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
