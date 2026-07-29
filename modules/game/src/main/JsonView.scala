package lila.game

import chess.format.Fen
import chess.{ Clock, Color }
import play.api.libs.json.*

import lila.common.Json.{ *, given }
import lila.core.LightUser
import lila.core.game.{ Blurs, Game, Player, Pov, Source }
import lila.game.GameExt.{ expirable, timeForFirstMove }

final class JsonView(rematches: Rematches):

  import JsonView.given

  def immutable(game: Game, initialFen: Option[Fen.Full]) =
    Json
      .obj(
        "id" -> game.id,
        "variant" -> game.variant,
        "speed" -> game.speed.key,
        "perf" -> game.perfKey,
        "rated" -> game.rated,
        "source" -> game.source,
        "createdAt" -> game.createdAt
      )
      .add("startedAtTurn" -> game.startedAtPly.some.filter(_ > 0))
      .add("initialFen" -> initialFen)
      .add("tournamentId" -> game.tournamentId)
      .add("swissId" -> game.swissId)
      .add("rules" -> game.metadata.nonEmptyRules)

  def base(game: Game, initialFen: Option[Fen.Full]) =
    immutable(game, initialFen) ++ Json
      .obj(
        "fen" -> game.position.fen,
        "turns" -> game.ply,
        "status" -> game.status
      )
      .add("winner" -> game.winnerColor)
      .add("abortedBy" -> game.abortedBy)
      .add("rematch" -> rematches.getAcceptedId(game.id))
      .add("drawOffers" -> (!game.drawOffers.isEmpty).option(game.drawOffers.normalizedPlies))

  // adds fields that should be computed by the client instead
  def baseWithPosition(game: Game, initialFen: Option[Fen.Full]) =
    base(game, initialFen) ++ Json
      .obj("player" -> game.turnColor)
      .add("check" -> game.position.check)
      .add("lastMove" -> game.lastMoveKeys)

  def apiAiNewGame(pov: Pov, initialFen: Option[Fen.Full]): JsObject =
    baseWithPosition(pov.game, initialFen) ++ Json.obj("fullId" -> pov.fullId)

  def ownerPreview(pov: Pov)(using LightUser.GetterSync) =
    Json
      .obj(
        "fullId" -> pov.fullId,
        "gameId" -> pov.gameId,
        "fen" -> maybeFen(pov),
        "color" -> pov.color,
        "lastMove" -> (pov.game.lastMoveKeys | ""),
        "source" -> pov.game.source,
        "status" -> pov.game.status,
        "variant" -> pov.game.variant,
        "speed" -> pov.game.speed.key,
        "perf" -> pov.game.perfKey,
        "rated" -> pov.game.rated,
        "hasMoved" -> pov.hasMoved,
        "opponent" -> Json
          .obj(
            "id" -> pov.opponent.userId,
            "username" -> lila.game.Namer
              .playerTextBlocking(pov.opponent, withRating = false)
          )
          .add("rating" -> pov.opponent.rating)
          .add("ratingDiff" -> pov.opponent.ratingDiff)
          .add("ai" -> pov.opponent.aiLevel),
        "isMyTurn" -> pov.isMyTurn
      )
      .add("secondsLeft" -> pov.remainingSeconds)
      .add("tournamentId" -> pov.game.tournamentId)
      .add("swissId" -> pov.game.swissId)
      .add("winner" -> pov.game.winnerColor)
      .add("rating" -> pov.player.rating)
      .add("ratingDiff" -> pov.player.ratingDiff)

  def maybeFen(pov: Pov): Fen.Full =
    Fen.Full(if pov.player.blindfold then "9/9/9/9/9/9/9/9/9/9 w - - 0 1" else pov.game.position.fen)

  def player(p: Player, user: Option[LightUser]) =
    Json
      .obj()
      .add("user", user)
      .add("rating", p.rating)
      .add("ratingDiff", p.ratingDiff)
      .add("name", p.name)
      .add("provisional" -> p.provisional)
      .add("aiLevel" -> p.aiLevel)
      .add("blindfold" -> p.blindfold)

object JsonView:

  def expiration(game: Game) =
    game.expirable.option:
      Json.obj(
        "idleMillis" -> (nowMillis - game.movedAt.toMillis),
        "millisToMove" -> game.timeForFirstMove.millis
      )

  given OWrites[chess.Status] = OWrites: s =>
    Json.obj(
      "id" -> s.id,
      "name" -> s.name
    )

  given OWrites[Crosstable.Result] = Json.writes

  given OWrites[Crosstable.Users] = OWrites: users =>
    JsObject(users.toList.map: u =>
      u.id.value -> JsNumber(u.score / 10d))

  given OWrites[Crosstable] = OWrites: c =>
    Json.obj(
      "users" -> c.users,
      "nbGames" -> c.nbGames
      // "results" -> c.results
    )

  given OWrites[Crosstable.Matchup] = OWrites: m =>
    Json.obj(
      "users" -> m.users,
      "nbGames" -> m.users.nbGames
    )

  given OWrites[Crosstable.WithMatchup] = OWrites: c =>
    Json.toJsObject(c.crosstable).add("matchup" -> c.matchup)

  given OWrites[Blurs] = OWrites: blurs =>
    import lila.game.Blurs.binaryString
    Json.obj(
      "nb" -> blurs.nb,
      "bits" -> blurs.binaryString
    )

  given OWrites[chess.variant.Variant] = OWrites: v =>
    Json.obj(
      "key" -> v.key,
      "name" -> v.name,
      "short" -> v.shortName
    )

  given OWrites[Clock] = OWrites: c =>
    Json.obj(
      "running" -> c.isRunning,
      "initial" -> c.limitSeconds,
      "increment" -> c.incrementSeconds,
      "white" -> c.remainingTime(Color.White).toSeconds,
      "black" -> c.remainingTime(Color.Black).toSeconds,
      "emerg" -> c.config.emergSeconds
    )

  given Writes[Source] = writeAs(_.name)
  given Writes[lila.core.game.GameRule] = writeAs(_.toString)
