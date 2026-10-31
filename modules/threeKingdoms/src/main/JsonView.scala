package lila.threeKingdoms

import play.api.libs.json.*
import lila.core.LightUser

final class JsonView(lightUser: LightUser.GetterSyncFallback):
  def preview(g: KingdomGame, user: UserId): JsObject = Json.obj(
    "gameId" -> g.id.value,
    "position" -> PositionCodec.write(g.position),
    "isMyTurn" -> g.playerOf(user).contains(g.position.turn),
    "hasBots" -> g.seats.exists(_.aiLevel.nonEmpty),
    "players" -> g.userIds.map(id => lightUser(id).name.value)
  )

  def apply(g: KingdomGame, history: Boolean = false): JsObject = Json.obj(
    "id" -> g.id.value,
    "variant" -> "threeKingdoms",
    "rules" -> "threeKingdoms-v1",
    "revision" -> g.revision,
    "position" -> PositionCodec.write(g.position),
    "eventCount" -> g.events.size,
    "initial" -> PositionCodec.write(g.initial),
    "rated" -> g.rated,
    "source" -> g.source,
    "createdAt" -> g.createdAt.toEpochMilli,
    "serverTime" -> nowMillis,
    "clock" -> Json.obj(
      "remaining" -> g.clock.remaining,
      "startedAt" -> g.clock.startedAt,
      "initialSeconds" -> g.clock.config.initialSeconds,
      "moveSeconds" -> g.clock.config.moveSeconds,
      "deadline" -> g.deadline
    ),
    "seats" -> Kingdom.values.toVector.map: k =>
      val seat = g.seats(k.ordinal)
      Json.obj(
        "color" -> k.color,
        "kingdom" -> k.key,
        "aiLevel" -> seat.aiLevel,
        "guest" -> seat.guest,
        "user" -> seat.userId.map(id => Json.obj("id" -> id.value, "name" -> lightUser(id).name.value)),
        "rank" -> seat.rank.flatMap(_.publicCode).map(_.value),
        "place" -> g.position.placement(k),
        "eliminated" -> !g.position.active.contains(k)
      )
    ,
    "events" -> (if history then g.events else g.events.takeRight(1)).map: e =>
      Json.obj("action" -> e.action, "actor" -> e.actor.color, "at" -> e.at, "clocks" -> e.clocks),
    "drawOffers" -> g.drawOffers.toVector.map(_.color),
    "takebackOffers" -> g.takebackOffers.toVector.map(_.color),
    "finished" -> g.position.finished,
    "tournamentId" -> g.tournamentId.map(_.value)
  )

  def record(g: KingdomGame): JsObject =
    apply(g, history = true) ++ Json.obj("format" -> "LiXiangQi Three Kingdoms", "formatVersion" -> 1)
