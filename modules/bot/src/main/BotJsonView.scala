package lila.bot

import play.api.libs.json.*

import lila.common.Json.given
import lila.core.game.{ Game, GameRepo, Pov, WithInitialFen }
import lila.core.rank.RankCode.*
import lila.game.JsonView.given

final class BotJsonView(
    lightUserApi: lila.core.user.LightUserApi,
    gameRepo: GameRepo,
    rematches: lila.game.Rematches
)(using Executor):

  def gameFull(game: Game): Fu[JsObject] = gameRepo.withInitialFen(game).flatMap(gameFull)

  def gameFull(wf: WithInitialFen): Fu[JsObject] =
    gameState(wf).map: state =>
      gameImmutable(wf) ++ Json.obj(
        "type" -> "gameFull",
        "state" -> state
      )

  def gameImmutable(wf: WithInitialFen): JsObject =
    import wf.*
    Json
      .obj(
        "id" -> game.id,
        "ruleset" -> game.xiangqi.ruleset.key,
        "variant" -> game.variant,
        "speed" -> game.speed.key,
        "perf" -> Json.obj("name" -> "Xiangqi"),
        "ranked" -> game.ranked,
        "createdAt" -> game.createdAt,
        "red" -> playerJson(game.pov(Color.white)),
        "black" -> playerJson(game.pov(Color.black)),
        "initialFen" -> game.xiangqi.initialFen
      )
      .add("clock" -> game.clock.map(_.config))
      .add("moveTime" -> game.moveTimeLimit)
      .add("daysPerTurn" -> game.daysPerTurn)
      .add("tournamentId" -> game.tournamentId)

  def gameState(wf: WithInitialFen): Fu[JsObject] =
    import wf.*
    fuccess(
      Json
        .obj(
          "type" -> "gameState",
          "ruleset" -> game.xiangqi.ruleset.key,
          "legalMoves" -> game.position.legalMoves.map(_.value),
          "variation" -> game.position.variation,
          "termination" -> game.position.termination,
          "moves" -> game.xiangqi.moves.map(_.value).mkString(" "),
          "rtime" -> millisRemaining(game, Color.white),
          "btime" -> millisRemaining(game, Color.black),
          "rinc" -> game.clock.so[Long](_.config.increment.millis),
          "binc" -> game.clock.so[Long](_.config.increment.millis),
          "status" -> game.status.name
        )
        .add("rdraw" -> game.whitePlayer.isOfferingDraw)
        .add("bdraw" -> game.blackPlayer.isOfferingDraw)
        .add("rtakeback" -> game.whitePlayer.isProposingTakeback)
        .add("btakeback" -> game.blackPlayer.isProposingTakeback)
        .add("winner" -> game.winnerColor.map(sideName))
        .add("rematch" -> rematches.getAcceptedId(game.id))
        .add("moveTime" -> game.moveTimeRemaining.map(_.millis.toInt))
        .add("expiration" -> lila.game.JsonView.expiration(game))
    )

  private def millisRemaining(game: Game, color: Color): Int =
    game.clock
      .map(_.remainingTime(color).millis.toInt)
      .orElse(game.correspondenceClock.map(_.remainingTime(color).toInt * 1000))
      .getOrElse(Int.MaxValue)

  def chatLine(username: UserName, text: String, player: Boolean) =
    Json.obj(
      "type" -> "chatLine",
      "room" -> (if player then "player" else "spectator"),
      "username" -> username,
      "text" -> text
    )

  def opponentGoneClaimIn(seconds: Int) = Json.obj(
    "type" -> "opponentGone",
    "gone" -> true,
    "claimWinInSeconds" -> seconds
  )
  def opponentGoneIsBack = Json.obj(
    "type" -> "opponentGone",
    "gone" -> false
  )

  private def playerJson(pov: Pov) =
    val light = pov.player.userId.flatMap(lightUserApi.sync)
    Json
      .obj()
      .add("aiLevel" -> pov.player.aiLevel)
      .add("id" -> light.map(_.id))
      .add("name" -> light.map(_.name))
      .add("title" -> light.map(_.title))
      .add("rank" -> pov.player.rank.flatMap(_.publicCode).map(_.value))

  private given OWrites[chess.Clock.Config] = OWrites: c =>
    Json.obj(
      "initial" -> c.limit.millis,
      "increment" -> c.increment.millis
    )

  private def sideName(color: Color) = if color.white then "red" else "black"
