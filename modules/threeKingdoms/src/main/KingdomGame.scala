package lila.threeKingdoms

import lila.core.rank.RankSnapshot
import java.time.Instant

final case class Seat(
    userId: Option[UserId],
    aiLevel: Option[Int],
    rank: Option[RankSnapshot],
    guest: Boolean = false
):
  require(Vector(userId.isDefined, aiLevel.isDefined, guest).count(identity) == 1)
  require(aiLevel.forall(n => n >= 1 && n <= 5))

final case class RecordedAction(action: String, actor: Kingdom, at: Long, clocks: Vector[Long])

/** One match, one identity, three immutable seats. Army controllers belong to the position, never to the
  * seats. Eliminated participants retain read access without any move authority.
  */
final case class KingdomGame(
    id: GameId,
    seats: Vector[Seat],
    initial: Position,
    position: Position,
    clock: ClockState,
    createdAt: Instant,
    movedAt: Instant,
    revision: Int = 0,
    events: Vector[RecordedAction] = Vector.empty,
    rated: Boolean = false,
    source: String = "friend",
    tournamentId: Option[TourId] = None,
    drawOffers: Set[Kingdom] = Set.empty,
    takebackOffers: Set[Kingdom] = Set.empty,
    settled: Boolean = false
):
  require(seats.size == 3 && seats.flatMap(_.userId).distinct.size == seats.count(_.userId.isDefined))
  require(Kingdom.values.forall(k => !seats(k.ordinal).guest || !position.active.contains(k)))
  require(
    !rated || (source == "pool" && seats.forall(s => s.userId.isDefined && s.rank.isDefined) &&
      clock.config == ClockConfig() && initial == Position.initial)
  )
  def userIds: List[UserId] = seats.flatMap(_.userId).toList
  def playerOf(userId: UserId): Option[Kingdom] =
    Kingdom.values.find(k => seats(k.ordinal).userId.contains(userId))
  def botHost: Option[UserId] = Option.when(seats.exists(_.aiLevel.isDefined))(userIds.headOption).flatten
  def canMove(userId: UserId): Boolean = !position.finished &&
    (seats(position.turn.ordinal).userId.contains(userId) ||
      (seats(position.turn.ordinal).aiLevel.isDefined && !unattendedDuel && botHost.contains(userId)))
  def deadline: Option[Long] = clock.deadline(position)
  def unattendedDuel: Boolean = !position.finished && position.active.size == 2 &&
    position.active.forall(k => seats(k.ordinal).aiLevel.isDefined)

  def record(transition: Transition, action: String, now: Long): KingdomGame =
    val nextClock = clock.advance(position, transition.position, now)
    val recorded = copy(
      position = transition.position,
      clock = nextClock,
      revision = revision + 1,
      movedAt = Instant.ofEpochMilli(now),
      drawOffers = Set.empty,
      takebackOffers = Set.empty,
      events = events :+ RecordedAction(action, transition.actor, now, nextClock.remaining)
    )
    recorded.finishComputerDuel(now)

  /** The human's loss ends computer play; surviving bots share the remaining places. */
  def finishComputerDuel(now: Long): KingdomGame =
    if !unattendedDuel then this
    else
      val end = Rules.agreeDraw(position).toOption.get
      record(Transition(end, None, position.turn), "draw", now)

  def move(userId: UserId, action: String, now: Long): Either[String, KingdomGame] =
    if !canMove(userId) then Left("notYourTurn")
    else if clock.expired(position, now) then Left("clockExpired")
    else
      val next = Move.parse(action).toRight("invalidMove").flatMap(Rules.play(position, _))
      next.map(record(_, action, now))

  def resign(userId: UserId, now: Long): Either[String, KingdomGame] =
    playerOf(userId).toRight("notAPlayer").flatMap(Rules.withdraw(position, _)).map(record(_, "resign", now))

  def flag(now: Long): Option[KingdomGame] = Option
    .when(clock.expired(position, now)):
      Rules.withdraw(position, position.turn, timeout = true).toOption.map(record(_, "timeout", now))
    .flatten

  def draw(userId: UserId, now: Long): Either[String, KingdomGame] =
    playerOf(userId)
      .filter(position.active.contains)
      .filter(_ => !position.finished)
      .toRight("notAnActivePlayer")
      .map: player =>
        val votes = drawOffers + player ++ Kingdom.values.filter(k => seats(k.ordinal).aiLevel.isDefined)
        if position.active.subsetOf(votes) then
          val end = Rules.agreeDraw(position).toOption.get
          record(Transition(end, None, player), "draw", now)
        else copy(drawOffers = votes, revision = revision + 1)

  def takeback(userId: UserId, now: Long): Either[String, KingdomGame] =
    if rated || tournamentId.nonEmpty || position.finished || events.isEmpty || Move
        .parse(events.last.action)
        .isEmpty
    then Left("takebackUnavailable")
    else
      for
        player <- playerOf(userId).toRight("notAPlayer")
        // Undo to the human's previous move, not a bot reply it would immediately repeat.
        index =
          if botHost.contains(userId) then
            events.lastIndexWhere(e => e.actor == player && Move.parse(e.action).nonEmpty)
          else events.size - 1
        _ <- Either.cond(index >= 0, (), "takebackUnavailable")
        kept = events.take(index)
        before <- KingdomGame.replay(initial, kept)
        _ <- Either.cond(before.active.contains(player), (), "notAnActivePlayer")
      yield
        val votes = takebackOffers + player ++ Kingdom.values.filter(k => seats(k.ordinal).aiLevel.isDefined)
        if !before.active.subsetOf(votes) then copy(takebackOffers = votes, revision = revision + 1)
        else
          copy(
            position = before,
            events = kept,
            revision = revision + 1,
            clock = clock.copy(
              remaining =
                kept.lastOption.fold(Vector.fill(3)(clock.config.initialSeconds.toLong * 1000))(_.clocks),
              startedAt = now
            ),
            drawOffers = Set.empty,
            takebackOffers = Set.empty,
            movedAt = Instant.ofEpochMilli(now)
          )

object KingdomGame:
  def replay(initial: Position, events: Vector[RecordedAction]): Either[String, Position] =
    events.foldLeft[Either[String, Position]](Right(initial)): (result, event) =>
      result.flatMap: position =>
        Rules.event(position, event.actor, event.action)
