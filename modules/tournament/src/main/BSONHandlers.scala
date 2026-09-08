package lila.tournament

import chess.Rated
import chess.format.Fen
import chess.variant.Variant
import reactivemongo.api.bson.*

import lila.core.id.TourPlayerId
import lila.core.rank.{ RankCode, RankDiff, RankScore, RankSnapshot, RankTrackId }
import lila.core.rank.RankTrackId.*
import lila.core.tournament.Status
import lila.core.tournament.leaderboard.Ratio
import lila.db.BSON
import lila.db.dsl.{ *, given }
import lila.rating.XiangqiRank

object BSONHandlers:


  private[tournament] given BSONHandler[Status] = valueMapHandler(Status.byId)(_.id)

  private[tournament] given BSONHandler[Schedule.Freq] = tryHandler(
    { case BSONString(v) => Schedule.Freq.byName.get(v).toTry(s"No such freq: $v") },
    x => BSONString(x.name)
  )

  given BSONWriter[Scheduled] = Macros.handler

  private given BSONHandler[chess.Clock.Config] = clockConfigHandler

  given BSONHandler[lila.ui.Icon] = isoHandler[lila.ui.Icon, String]
  private given BSONDocumentHandler[Spotlight] = Macros.handler

  given BSONDocumentHandler[TeamBattle] = Macros.handler

  private given BSONHandler[Ratio] = BSONIntegerHandler.as(
    i => Ratio(i.toDouble / 100_000),
    r => (r.value * 100_000).toInt
  )

  import TournamentCondition.bsonHandler

  private given BSON[RankSnapshot] with
    def reads(r: BSON.Reader) = RankSnapshot(
      track = r.strO("t").flatMap(RankTrackId.from).getOrElse(RankTrackId.xiangqi),
      score = RankScore(r.int("s")),
      code = RankCode(r.str("c")),
      ordinal = r.int("o"),
      catalogVersion = r.intO("cv").orElse(r.intO("v")).getOrElse(XiangqiRank.firstCatalogVersion),
      policyVersion = r.intO("pv").getOrElse(XiangqiRank.firstPolicyVersion),
      established = r.boolD("e"),
      diff = r.intO("d").map(RankDiff.apply),
      after = r.strO("a").map(RankCode.apply)
    )

    def writes(w: BSON.Writer, rank: RankSnapshot) = $doc(
      "t" -> rank.track.value,
      "s" -> rank.score.value,
      "c" -> rank.code.value,
      "o" -> rank.ordinal,
      "cv" -> rank.catalogVersion,
      "pv" -> rank.policyVersion,
      "e" -> rank.established.option(true),
      "d" -> rank.diff.map(_.value),
      "a" -> rank.after.map(_.value)
    )

  given tourHandler: BSON[Tournament] with
    def reads(r: BSON.Reader) =
      val variant = Variant.idOrDefault(r.getO[Variant.Id]("variant"))
      val position: Option[Fen.Standard] =
        r.getO[Fen.Full]("fen")
          .map(_.opening: Fen.Standard)
          .filter(_ != Fen.Standard.initial)
      val startsAt = r.date("startsAt")
      val status = r.get[Status]("status")
      val schedule = for
        doc <- r.getO[Bdoc]("schedule")
        freq <- doc.getAsOpt[Schedule.Freq]("freq")
        at = doc.getAsOpt[LocalDateTime]("at") | startsAt.dateTime
      yield Scheduled(freq, at)
      val storedConditions = r.getD[TournamentCondition.All]("conditions")
      // Deployments preserve the live tournament collection. Open scheduled
      // tournaments that have not started yet, while leaving tournament
      // history and events already in progress unchanged.
      val conditions =
        if schedule.isDefined && status == Status.created then TournamentCondition.All.empty
        else storedConditions
      Tournament(
        id = r.get[TourId]("_id"),
        name = r.str("name"),
        status = status,
        clock = r.get[chess.Clock.Config]("clock"),
        minutes = r.int("minutes"),
        variant = variant,
        position = position,
        rated = Rated.No,
        password = r.strO("password"),
        conditions = conditions,
        teamBattle = r.getO[TeamBattle]("teamBattle"),
        noBerserk = r.boolD("noBerserk"),
        noStreak = r.boolD("noStreak"),
        schedule = schedule,
        nbPlayers = r.int("nbPlayers"),
        createdAt = r.date("createdAt"),
        createdBy = r.getO[UserId]("createdBy") | UserId.lichess,
        startsAt = startsAt,
        winnerId = r.getO[UserId]("winner"),
        featured = r.getO[GameId]("featured"),
        spotlight = r.getO[Spotlight]("spotlight"),
        description = r.strO("description"),
        payouts = r.getO[Payouts]("payouts"),
        hasChat = r.boolO("chat").getOrElse(true),
        ruleset = if r.contains("ruleset") then
          lila.xiangqi.adjudication.Ruleset.fromKey(r.str("ruleset")).fold(sys.error, identity)
          else if status == Status.created then lila.xiangqi.adjudication.Ruleset.default
          else lila.xiangqi.adjudication.Ruleset.Unrestricted
      )
    def writes(w: BSON.Writer, o: Tournament) =
      $doc(
        "_id" -> o.id,
        "name" -> o.name,
        "status" -> o.status,
        "clock" -> o.clock,
        "minutes" -> o.minutes,
        "variant" -> o.variant.some.filterNot(_.standard).map(_.id),
        "fen" -> o.position,
        "password" -> o.password,
        "conditions" -> o.conditions.nonEmpty.option(o.conditions),
        "teamBattle" -> o.teamBattle,
        "noBerserk" -> w.boolO(o.noBerserk),
        "noStreak" -> w.boolO(o.noStreak),
        "schedule" -> o.schedule,
        "nbPlayers" -> o.nbPlayers,
        "createdAt" -> w.date(o.createdAt),
        "createdBy" -> o.nonLichessCreatedBy,
        "startsAt" -> w.date(o.startsAt),
        "winner" -> o.winnerId,
        "featured" -> o.featured,
        "spotlight" -> o.spotlight,
        "description" -> o.description,
        "payouts" -> o.payouts,
        "chat" -> (!o.hasChat).option(false),
        "ruleset" -> o.ruleset.key
      )

  given BSON[Player] with
    def reads(r: BSON.Reader) =
      Player(
        _id = r.get[TourPlayerId]("_id"),
        tourId = r.get("tid"),
        userId = r.get("uid"),
        rank = r.getO[RankSnapshot]("xr").getOrElse(XiangqiRank.initialSnapshot),
        withdraw = r.boolD("w"),
        score = r.intD("s"),
        fire = r.boolD("f"),
        team = r.getO[TeamId]("t"),
        bot = r.boolD("bot")
      )
    def writes(w: BSON.Writer, o: Player) =
      $doc(
        "_id" -> o._id,
        "tid" -> o.tourId,
        "uid" -> o.userId,
        "xr" -> o.rank,
        "w" -> w.boolO(o.withdraw),
        "s" -> w.intO(o.score),
        "m" -> o.magicScore,
        "f" -> w.boolO(o.fire),
        "t" -> o.team,
        "bot" -> w.boolO(o.bot)
      )

  given pairingHandler: BSON[Pairing] with
    def reads(r: BSON.Reader) =
      val users = r.strsD("u")
      val user1 = UserId(users.headOption.err("tournament pairing first user"))
      val user2 = UserId(users.lift(1).err("tournament pairing second user"))
      Pairing(
        id = r.get[GameId]("_id"),
        tourId = r.get[TourId]("tid"),
        status = chess.Status(r.int("s")).err("tournament pairing status"),
        user1 = user1,
        user2 = user2,
        winner = r.boolO("w").map {
          if _ then user1
          else user2
        },
        turns = r.intO("t"),
        berserk1 = r.intO("b1").fold(r.boolD("b1"))(1 ==), // it used to be int = 0/1
        berserk2 = r.intO("b2").fold(r.boolD("b2"))(1 ==)
      )
    def writes(w: BSON.Writer, o: Pairing) =
      $doc(
        "_id" -> o.id,
        "tid" -> o.tourId,
        "s" -> o.status.id,
        "u" -> BSONArray(o.user1, o.user2),
        "w" -> o.winner.map(o.user1 ==),
        "t" -> o.turns,
        "b1" -> w.boolO(o.berserk1),
        "b2" -> w.boolO(o.berserk2)
      )

  given BSON[LeaderboardApi.Entry] with
    def reads(r: BSON.Reader) =
      LeaderboardApi.Entry(
        id = r.get("_id"),
        userId = r.get("u"),
        tourId = r.get("t"),
        nbGames = r.int("g"),
        score = r.int("s"),
        rank = r.get("r"),
        rankRatio = r.get("w"),
        date = r.date("d")
      )

    def writes(w: BSON.Writer, o: LeaderboardApi.Entry) =
      $doc(
        "_id" -> o.id,
        "u" -> o.userId,
        "t" -> o.tourId,
        "g" -> o.nbGames,
        "s" -> o.score,
        "r" -> o.rank,
        "w" -> o.rankRatio,
        "d" -> w.date(o.date)
      )
