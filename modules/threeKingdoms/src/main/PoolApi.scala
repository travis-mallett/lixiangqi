package lila.threeKingdoms

import scalalib.actor.AsyncActorSequencers
import play.api.libs.json.{ Json, JsObject }
import lila.core.rank.RankSnapshot

/** Like the native pools, waiting is ephemeral. A matched game is persisted before any redirect. Short leases
  * remove disconnected clients; all queue mutations run on one sequencer.
  */
final class PoolApi(
    repo: GameRepo,
    maker: GameMaker,
    users: lila.user.UserApi,
    relations: lila.core.relation.RelationApi,
    hasCurrentPlayban: lila.core.playban.HasCurrentPlayban,
    participation: lila.core.pool.PoolParticipation
)(using Executor, Scheduler):
  private case class Entry(
      user: UserId,
      seat: Seat,
      blocked: Set[UserId],
      avoid: Set[UserId],
      joined: Long,
      seen: Long
  ):
    def rank: RankSnapshot = seat.rank.get
  private case class Matched(id: GameId, expires: Long)
  private var waiting = Map.empty[UserId, Entry]
  private var matched = Map.empty[UserId, Matched]
  private val queue = AsyncActorSequencers[String](
    Max(1024),
    1.hour,
    15.seconds,
    "threeKingdoms.pool",
    lila.mon.asyncActorMonitor.full
  )

  lila.common.Bus.sub[MatchUpdated]: event =>
    if event.game.rated then
      queue("pool"):
        val g = event.game
        participation.release(
          g.id,
          g.userIds.filter(user =>
            g.position.finished || g.playerOf(user).forall(k => !g.position.active.contains(k))
          )
        )
        matched = matched.filterNot((user, entry) =>
          entry.id == g.id &&
            (g.position.finished || g.playerOf(user).forall(k => !g.position.active.contains(k)))
        )
        funit

  def join(user: User): Fu[JsObject] = hasCurrentPlayban(user.id).flatMap:
    case true => fuccess(Json.obj("error" -> "playbanned"))
    case false => joinAllowed(user)

  private def joinAllowed(user: User): Fu[JsObject] = queue("pool"):
    val now = nowMillis
    waiting = waiting.filter((_, entry) => entry.seen > now - 15000)
    matched = matched.filter((_, entry) => entry.expires > now)
    if !user.rankable || user.isBot then fuccess(Json.obj("error" -> "ratedUnavailable"))
    else
      matched.get(user.id) match
        case Some(m) => fuccess(Json.obj("gameId" -> m.id.value))
        case None if !participation.join(user.id, "threeKingdoms", now) =>
          fuccess(Json.obj("error" -> "ongoingGame"))
        case None =>
          val entered = waiting.get(user.id) match
            case Some(entry) =>
              waiting = waiting.updated(user.id, entry.copy(seen = now))
              funit
            case None if waiting.size >= 1000 => fufail("Three Kingdoms pool is full")
            case None =>
              repo
                .playing(user.id)
                .flatMap: playing =>
                  playing.find(g => g.playerOf(user.id).exists(g.position.active.contains)) match
                    case Some(game) =>
                      matched = matched.updated(user.id, Matched(game.id, now + 300000))
                      funit
                    case None =>
                      for
                        seats <- maker.seats(Vector(user.id))
                        blocked <- relations.fetchBlocking(user.id)
                        recent <- repo.recentOpponents(user.id, nowInstant.minusSeconds(3600))
                      yield
                        val repeated = recent
                          .flatMap(_.userIds.filterNot(_ == user.id))
                          .groupMapReduce(identity)(_ => 1)(_ + _)
                          .collect { case (id, n) if n >= 3 => id }
                          .toSet
                        waiting =
                          waiting.updated(user.id, Entry(user.id, seats.head, blocked, repeated, now, now))
          entered
            .flatMap(_ => pair())
            .map: _ =>
              matched
                .get(user.id)
                .fold(Json.obj("waiting" -> true, "count" -> waiting.size))(m =>
                  Json.obj("gameId" -> m.id.value)
                )

  def leave(user: UserId): Fu[JsObject] = queue("pool"):
    waiting -= user
    participation.leave(user, "threeKingdoms")
    fuccess(matched.get(user).fold(Json.obj("waiting" -> false))(m => Json.obj("gameId" -> m.id.value)))

  private def compatible(a: Entry, b: Entry): Boolean =
    (a.rank.matchingGroup - b.rank.matchingGroup).abs <= 1 &&
      !a.blocked.contains(b.user) && !b.blocked.contains(a.user) &&
      !a.avoid.contains(b.user) && !b.avoid.contains(a.user)

  private def pair(): Funit =
    val candidates = waiting.values.toVector.sortBy(_.joined).take(80)
    val triple = candidates.indices.iterator
      .flatMap: i =>
        val a = candidates(i)
        val peers = candidates.drop(i + 1).filter(compatible(a, _))
        peers.indices.iterator
          .flatMap(j => peers.drop(j + 1).find(compatible(peers(j), _)).map(b => Vector(a, peers(j), b)))
      .nextOption()
    triple.fold(funit): entries =>
      users
        .byIds(entries.map(_.user).toList)
        .zip(entries.traverse(e => hasCurrentPlayban(e.user)))
        .flatMap: (accounts, bans) =>
          if accounts.size != 3 || accounts.exists(u => !u.rankable || u.isBot) || bans.exists(identity) then
            waiting --= entries.map(_.user)
            funit
          else
            val shuffled = scala.util.Random.shuffle(entries)
            val id = GameId(scalalib.SecureRandom.nextString(GameId.size))
            val ids = shuffled.map(_.user).toList
            if !participation.reserve("threeKingdoms", ids, id, nowMillis) then
              waiting --= ids
              funit
            else
              maker
                .create(shuffled.map(_.seat), ClockConfig(), "pool", id)
                .map: game =>
                  waiting --= ids
                  matched ++= entries.map(e => e.user -> Matched(game.id, nowMillis + 300000))
                .recoverWith: error =>
                  repo
                    .byId(id)
                    .flatMap:
                      case Some(_) => fufail(error)
                      case None => participation.release(id, ids); fufail(error)
