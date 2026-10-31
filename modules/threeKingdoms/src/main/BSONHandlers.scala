package lila.threeKingdoms

import reactivemongo.api.bson.*
import lila.db.BSON
import lila.db.dsl.{ *, given }
import lila.core.rank.{ RankSnapshot, RankTrackId, RankScore, RankCode, RankDiff }

private[threeKingdoms] object BSONHandlers:
  given BSONHandler[Kingdom] =
    quickHandler[Kingdom]({ case BSONInteger(n) => Kingdom.values(n) }, k => BSONInteger(k.ordinal))
  given BSONHandler[Position] = quickHandler[Position](
    { case BSONString(s) => PositionCodec.read(s).fold(sys.error, identity) },
    p => BSONString(PositionCodec.write(p))
  )
  given BSONDocumentHandler[ClockConfig] = Macros.handler
  given BSONDocumentHandler[ClockState] = Macros.handler
  given BSON[RankSnapshot] with
    def reads(r: BSON.Reader) = RankSnapshot(
      RankTrackId.threeKingdoms,
      RankScore(r.int("score")),
      RankCode(r.str("code")),
      r.int("ordinal"),
      r.int("catalogVersion"),
      r.int("policyVersion"),
      r.bool("established"),
      r.intO("diff").map(RankDiff(_)),
      r.strO("after").map(RankCode(_))
    )
    def writes(w: BSON.Writer, s: RankSnapshot) = $doc(
      "score" -> s.score.value,
      "code" -> s.code.value,
      "ordinal" -> s.ordinal,
      "catalogVersion" -> s.catalogVersion,
      "policyVersion" -> s.policyVersion,
      "established" -> s.established,
      "diff" -> s.diff.map(_.value),
      "after" -> s.after.map(_.value)
    )
  given BSONDocumentHandler[Seat] = Macros.handler
  given BSONDocumentHandler[RecordedAction] = Macros.handler
  given BSON[KingdomGame] with
    def reads(r: BSON.Reader) = KingdomGame(
      r.get[GameId]("_id"),
      r.get[Vector[Seat]]("seats"),
      r.get[Position]("initial"),
      r.get[Position]("position"),
      r.get[ClockState]("clock"),
      r.date("createdAt"),
      r.date("movedAt"),
      r.int("revision"),
      r.get[Vector[RecordedAction]]("events"),
      r.bool("rated"),
      r.str("source"),
      r.getO[TourId]("tournamentId"),
      r.get[Set[Kingdom]]("drawOffers"),
      r.get[Set[Kingdom]]("takebackOffers"),
      r.bool("settled")
    )
    def writes(w: BSON.Writer, g: KingdomGame) = $doc(
      "_id" -> g.id,
      "seats" -> g.seats,
      "users" -> g.userIds,
      "initial" -> g.initial,
      "position" -> g.position,
      "clock" -> g.clock,
      "createdAt" -> g.createdAt,
      "movedAt" -> g.movedAt,
      "revision" -> g.revision,
      "events" -> g.events,
      "rated" -> g.rated,
      "source" -> g.source,
      "tournamentId" -> g.tournamentId,
      "drawOffers" -> g.drawOffers,
      "takebackOffers" -> g.takebackOffers,
      "settled" -> g.settled,
      "finished" -> g.position.finished,
      "unattendedDuel" -> g.unattendedDuel,
      "deadline" -> g.deadline,
      "playingUsers" -> g.userIds.filter(id =>
        !g.position.finished && g.playerOf(id).exists(g.position.active.contains)
      ),
      "winners" -> g.userIds.filter(id => g.playerOf(id).flatMap(g.position.placement).contains(1d)),
      "losers" -> g.position.eliminated.flatMap(e => g.seats(e.player.ordinal).userId),
      "draws" -> g.userIds.filter(id =>
        g.position.ending.exists(_.draw) && g.playerOf(id).exists(g.position.active.contains)
      )
    )
