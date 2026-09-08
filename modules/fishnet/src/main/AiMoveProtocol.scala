package lila.fishnet

import play.api.libs.json.*

import scala.util.Try

import lila.core.fishnet.{ AiMoveRequestId, AiTurnKey }
import lila.xiangqi.Xiangqi

/** Versioned Redis boundary for interactive computer moves.
  *
  * This is intentionally separate from the HTTP Fishnet analysis protocol. Keep the corresponding Python
  * parser covered by the shared turn-key test vector whenever this schema or its canonical identity changes.
  */
private[fishnet] object AiMoveProtocol:

  val requestChannel = "fishnet-move-v2-out"
  val resultChannel = "fishnet-move-v2-in"

  enum Result:
    case WorkerReady
    case Move(gameId: GameId, requestId: AiMoveRequestId, turnKey: AiTurnKey, uci: Xiangqi.Uci)
    case Failure(gameId: GameId, requestId: AiMoveRequestId, turnKey: AiTurnKey, code: String)

  def write(work: Work.Move): String =
    Json.stringify:
      Json.obj(
        "version" -> 2,
        "type" -> "move",
        "requestId" -> work._id.value,
        "gameId" -> work.game.id,
        "turnKey" -> work.turnKey.value,
        "level" -> work.level,
        "position" -> Json.obj(
          "variant" -> "xiangqi",
          "ruleset" -> work.ruleset.key,
          "legalMoves" -> work.legalMoves.map(_.value),
          "initialFen" -> work.game.initialFen.fold(Xiangqi.startFen)(_.value),
          "moves" -> work.game.moves.split(' ').filter(_.nonEmpty)
        ),
        "clock" -> work.clock.fold[JsValue](JsNull): clock =>
          Json.obj("wtime" -> clock.wtime, "btime" -> clock.btime, "inc" -> clock.inc.value)
      )

  def read(payload: String): Either[String, Result] =
    Try(Json.parse(payload)).toEither.left
      .map(_.getMessage)
      .flatMap: json =>
        if !(json \ "version").asOpt[Int].contains(2) then Left("unsupported version")
        else
          (json \ "type").asOpt[String] match
            case Some("workerReady") => Right(Result.WorkerReady)
            case Some("move") =>
              for
                gameId <- identityField(json, "gameId", "[A-Za-z0-9]{8}").map(GameId.apply)
                requestId <- identityField(json, "requestId", "[A-Za-z0-9]{12}").map(AiMoveRequestId.apply)
                turnKey <- identityField(json, "turnKey", "[0-9a-f]{64}").map(AiTurnKey.apply)
                uciString <- field[String](json, "move")
                uci <- Xiangqi.Uci.from(uciString).toOption.toRight("invalid Xiangqi move")
              yield Result.Move(gameId, requestId, turnKey, uci)
            case Some("failure") =>
              for
                gameId <- identityField(json, "gameId", "[A-Za-z0-9]{8}").map(GameId.apply)
                requestId <- identityField(json, "requestId", "[A-Za-z0-9]{12}").map(AiMoveRequestId.apply)
                turnKey <- identityField(json, "turnKey", "[0-9a-f]{64}").map(AiTurnKey.apply)
                code <- identityField(json, "code", "[A-Za-z0-9_.-]{1,64}")
              yield Result.Failure(gameId, requestId, turnKey, code)
            case other => Left(s"unexpected message type: $other")

  private def field[A: Reads](json: JsValue, name: String): Either[String, A] =
    (json \ name).asOpt[A].toRight(s"missing or invalid $name")

  private def identityField(json: JsValue, name: String, pattern: String): Either[String, String] =
    field[String](json, name).filterOrElse(_.matches(pattern), s"invalid $name")
