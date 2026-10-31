package lila.setup

import chess.ByColor
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import play.api.libs.json.*
import reactivemongo.api.bson.BSONDocument

import lila.core.game.{ FinishGame, Game, KidsBotProfile }
import lila.core.id.GamePlayerId
import lila.db.AsyncColl
import lila.db.dsl.{ *, given }
import lila.lobby.TriColor

/** Each request reserves an immutable game identity before game insertion. Retrying after any crash recreates
  * only that identity and those player IDs. Results are derived from authoritative games; clients never
  * submit a win.
  */
final class KidsBots(coll: AsyncColl, processor: Processor, gameRepo: lila.core.game.GameRepo)(using
    Executor
):
  import KidsBots.*

  private def docs(owner: String): Fu[List[BSONDocument]] =
    coll(_.find($doc("_id".$startsWith(s"$owner:"))).cursor[BSONDocument]().listAll())

  private def get(key: String): Fu[Option[BSONDocument]] = coll(_.find($id(key)).one[BSONDocument])

  def start(owner: String, request: Request)(using me: Option[Me]): Fu[JsObject] =
    val key = s"$owner:${request.requestId}"
    get(key).flatMap:
      case Some(doc) => restore(owner, request, doc)
      case None =>
        processor
          .prepareAi(config(request.botId, request.side))
          .flatMap: candidate =>
            val doc = $doc(
              "_id" -> key,
              "owner" -> owner,
              "requestId" -> request.requestId,
              "botId" -> request.botId,
              "profile" -> KidsBotProfile.byId(request.botId).get.key,
              "requestSide" -> request.side,
              "side" -> (if candidate.color.white then "red" else "black"),
              "initialChallenge" -> request.challenge,
              "challenge" -> request.challenge,
              "id" -> candidate.gameId.value,
              "redPlayer" -> candidate.game.whitePlayer.id.value,
              "blackPlayer" -> candidate.game.blackPlayer.id.value,
              "at" -> nowInstant.toString,
              "finished" -> false
            )
            reserve(owner, doc).flatMap: winner =>
              ensureReceipt(winner).flatMap: receipt =>
                restore(owner, requestFrom(receipt), receipt)

  // An atomic owner slot prevents two simultaneous devices creating two games.
  // The complete reservation is stored in that slot so every crash is recoverable.
  private def reserve(owner: String, candidate: BSONDocument): Fu[BSONDocument] =
    val slot = s"slot/$owner"
    get(slot).flatMap:
      case None =>
        coll(
          _.update.one($id(slot), $doc("$setOnInsert" -> $doc("reservation" -> candidate)), upsert = true)
        ).void.recover(lila.db.ignoreDuplicateKey).flatMap(_ => reserve(owner, candidate))
      case Some(current) =>
        val previous = current.getAsOpt[BSONDocument]("reservation").get
        if str(previous, "_id") == str(candidate, "_id") then fuccess(previous)
        else
          gameRepo
            .game(GameId(str(previous, "id")))
            .flatMap:
              case Some(game) if game.finishedOrAborted =>
                coll(
                  _.update.one(
                    $id(slot) ++ $doc("reservation._id" -> str(previous, "_id")),
                    $set("reservation" -> candidate)
                  )
                ).flatMap(_ => reserve(owner, candidate))
              case _ => fuccess(previous)

  private def ensureReceipt(doc: BSONDocument): Fu[BSONDocument] =
    val key = str(doc, "_id")
    coll(_.update.one($id(key), $doc("$setOnInsert" -> doc), upsert = true)).void
      .recover(lila.db.ignoreDuplicateKey)
      .flatMap(_ => get(key))
      .map(_.get)

  private def requestFrom(doc: BSONDocument) = Request(
    str(doc, "botId"),
    str(doc, "requestSide"),
    bool(doc, "initialChallenge"),
    str(doc, "requestId")
  )

  private def restore(owner: String, request: Request, doc: BSONDocument)(using Option[Me]): Fu[JsObject] =
    if str(doc, "botId") != request.botId || str(doc, "requestSide") != request.side ||
      bool(doc, "initialChallenge") != request.challenge
    then fufail(IllegalArgumentException("Request identity already used"))
    else if bool(doc, "finished") then fuccess(Json.obj("game" -> gameJson(doc, owner)))
    else
      val id = GameId(str(doc, "id"))
      gameRepo
        .game(id)
        .flatMap:
          case Some(game) =>
            if !game.finishedOrAborted then processor.startKidsAi(game.id)
            recordGame(game)
              .flatMap(_ => get(str(doc, "_id")))
              .map(d => Json.obj("game" -> gameJson(d.get, owner)))
          case None =>
            processor
              .prepareAi(config(request.botId, str(doc, "side")))
              .flatMap: fresh =>
                val game = fresh.game.copy(
                  id = id,
                  players = ByColor: color =>
                    fresh.game
                      .player(color)
                      .copy(id = GamePlayerId(str(doc, if color.white then "redPlayer" else "blackPlayer"))),
                  metadata = fresh.game.metadata.copy(
                    kidsBotProfile = Some(str(doc, "profile")),
                    kidsBotReceipt = Some(str(doc, "_id"))
                  )
                )
                processor
                  .insertKidsAi(Pov(game, fresh.color))
                  .inject(Json.obj("game" -> gameJson(doc, owner)))

  def assist(owner: String, id: GameId): Funit =
    owned(owner, id).flatMap: doc =>
      if bool(doc, "finished") then fufail(IllegalArgumentException("Game already finished"))
      else coll(_.update.one($id(str(doc, "_id")), $set("challenge" -> false, "assisted" -> true))).void

  private def owned(owner: String, id: GameId): Fu[BSONDocument] =
    gameRepo
      .game(id)
      .flatMap:
        case Some(game) =>
          game.metadata.kidsBotReceipt
            .filter(_.startsWith(s"$owner:"))
            .fold(
              fufail[BSONDocument](IllegalArgumentException("Not your bot game"))
            )(key =>
              get(key)
                .flatMap(_.fold(fufail[BSONDocument](IllegalArgumentException("Missing bot game")))(fuccess))
            )
        case None => fufail(IllegalArgumentException("Missing bot game"))

  def reconcile(owner: String, id: GameId)(using Option[Me]): Fu[JsObject] =
    owned(owner, id).flatMap: _ =>
      gameRepo.game(id).flatMap(_.so(recordGame)).flatMap(_ => profile(owner))

  def record(finish: FinishGame): Funit = recordGame(finish.game)

  private def recordGame(game: Game): Funit =
    game.metadata.kidsBotReceipt.so: key =>
      if !game.finishedOrAborted then
        if game.metadata.kidsBotAssisted then
          coll(_.update.one($id(key), $set("challenge" -> false, "assisted" -> true))).void
        else funit
      else
        game.aiPov.so: ai =>
          val human = !ai.color
          val result = if game.aborted then "aborted"
          else if game.drawn then "draw"
          else if game.winnerColor.contains(human) then "win"
          else "loss"
          coll(
            _.update.one(
              $id(key),
              $doc(
                "$set" -> ($doc(
                  "finished" -> true,
                  "result" -> result,
                  "played" -> (!game.aborted && game.status != chess.Status.Resign),
                  "moves" -> game.xiangqi.moves.map(_.value),
                  "initialFen" -> game.xiangqi.initialFen
                ) ++ (if game.metadata.kidsBotAssisted then $doc("challenge" -> false, "assisted" -> true)
                      else $empty))
              )
            )
          ).void

  def profile(owner: String)(using Option[Me]): Fu[JsObject] =
    // Finish a reserved start before advertising a resumable game.
    get(s"slot/$owner")
      .flatMap: slot =>
        slot
          .flatMap(_.getAsOpt[BSONDocument]("reservation"))
          .so: doc =>
            ensureReceipt(doc).flatMap(receipt => restore(owner, requestFrom(receipt), receipt)).void
      .flatMap(_ => snapshot(owner))

  private def snapshot(owner: String): Fu[JsObject] =
    // Recover results if a finish notification was interrupted during deployment.
    docs(owner).flatMap: all =>
      all
        .filterNot(bool(_, "finished"))
        .sequentiallyVoid: doc =>
          gameRepo.game(GameId(str(doc, "id"))).flatMap(_.so(recordGame))
        .flatMap: _ =>
          docs(owner).map: records =>
            val finished = records.filter(bool(_, "finished"))
            val progress = KidsBotProfile.all.map: bot =>
              val games = finished.filter(d => str(d, "botId") == bot.id && str(d, "result") != "aborted")
              bot.id -> Json.obj(
                "games" -> games.size,
                "wins" -> games.count(str(_, "result") == "win"),
                "draws" -> games.count(str(_, "result") == "draw"),
                "losses" -> games.count(str(_, "result") == "loss"),
                "challengeWins" -> games.count(d => str(d, "result") == "win" && bool(d, "challenge")),
                "played" -> games.exists(bool(_, "played"))
              )
            Json.obj(
              "progress" -> JsObject(progress),
              "history" -> finished.sortBy(str(_, "at")).reverse.take(50).map(gameJson(_, owner)),
              "active" -> records
                .filterNot(bool(_, "finished"))
                .sortBy(str(_, "at"))
                .lastOption
                .map(gameJson(_, owner))
            )

  def delete(userId: UserId): Funit =
    coll(_.delete.one($doc("_id".$startsWith(s"user/${userId.value}:"))).void)
      .flatMap(_ => coll(_.delete.one($id(s"slot/user/${userId.value}")).void))

object KidsBots:
  case class Request(botId: String, side: String, challenge: Boolean, requestId: String)
  def request(fields: Map[String, String]): Either[String, Request] =
    for
      bot <- fields.get("botId").filter(KidsBotProfile.byId(_).isDefined).toRight("Unknown bot")
      side <- fields.get("side").filter(Set("red", "black", "random")).toRight("Invalid side")
      challenge <- fields.get("challenge").filter(Set("true", "false")).toRight("Invalid mode")
      id <- fields.get("requestId").filter(_.matches("[a-f0-9]{48}")).toRight("Invalid request identity")
    yield Request(bot, side, challenge == "true", id)

  def owner(user: Option[UserId], guest: Option[String]): Option[String] = user
    .map(id => s"user/${id.value}")
    .orElse:
      guest
        .filter(_.matches("[a-f0-9]{48}"))
        .map: key =>
          val hash = MessageDigest
            .getInstance("SHA-256")
            .digest(key.getBytes(StandardCharsets.UTF_8))
            .map(b => f"${b & 0xff}%02x")
            .mkString
          s"guest/$hash"

  private def config(bot: String, side: String) = AiConfig.default.copy(
    level = KidsBotProfile.byId(bot).get.level,
    color =
      if side == "red" then TriColor.White else if side == "black" then TriColor.Black else TriColor.Random,
    ruleset = Some("tiantian-v1")
  )
  private def str(d: BSONDocument, key: String): String = d.getAsOpt[String](key).getOrElse("")
  private def bool(d: BSONDocument, key: String): Boolean = d.getAsOpt[Boolean](key).contains(true)
  private def gameJson(d: BSONDocument, owner: String): JsObject =
    val player = str(d, if str(d, "side") == "red" then "redPlayer" else "blackPlayer")
    Json.obj(
      "id" -> (str(d, "id") + (if owner.startsWith("guest/") then player else "")),
      "botId" -> str(d, "botId"),
      "requestId" -> str(d, "requestId"),
      "side" -> str(d, "side"),
      "challenge" -> bool(d, "challenge"),
      "assisted" -> bool(d, "assisted"),
      "finished" -> bool(d, "finished"),
      "result" -> d.getAsOpt[String]("result"),
      "at" -> str(d, "at"),
      "moves" -> d.getAsOpt[List[String]]("moves").getOrElse(Nil),
      "initialFen" -> d.getAsOpt[String]("initialFen")
    )
