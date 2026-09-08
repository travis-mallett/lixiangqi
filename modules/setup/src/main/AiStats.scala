package lila.setup

import reactivemongo.api.bson.BSONDocument

import lila.core.game.{ FinishGame, Game }
import lila.db.AsyncColl
import lila.db.dsl.{ *, given }

final case class AiStats(wins: Long = 0, draws: Long = 0, losses: Long = 0):
  val games = wins + draws + losses

final case class AiLevelStats(level: Int, registered: AiStats, mine: Option[AiStats])

final private[setup] case class AiRecordedResult(userId: UserId, level: Int, result: AiResult)

private[setup] enum AiResult(val field: String):
  case Win extends AiResult("wins")
  case Draw extends AiResult("draws")
  case Loss extends AiResult("losses")

final class AiStatsApi(coll: AsyncColl)(using Executor):

  def get(userId: Option[UserId]): Fu[List[AiLevelStats]] =
    val ids =
      AiConfig.levels.map(globalId) ::: userId.toList.flatMap: id =>
        AiConfig.levels.map(userLevelId(id, _))
    coll: c =>
      c.find($inIds(ids))
        .cursor[BSONDocument]()
        .listAll()
        .map: docs =>
          val byId = docs.flatMap(doc => doc.getAsOpt[String]("_id").map(_ -> read(doc))).toMap
          AiConfig.levels.map: level =>
            AiLevelStats(
              level = level,
              registered = byId.getOrElse(globalId(level), AiStats()),
              mine = userId.map(id => byId.getOrElse(userLevelId(id, level), AiStats()))
            )

  def record(finish: FinishGame): Funit =
    recordedResult(finish).so: recorded =>
      List(
        increment(globalId(recorded.level), recorded.result),
        increment(userLevelId(recorded.userId, recorded.level), recorded.result)
      ).parallel.void

  def delete(userId: UserId): Funit =
    coll(_.delete.one($doc("_id".$startsWith(s"user/${userId.value}/"))).void)

  private def increment(id: String, result: AiResult): Funit =
    coll: c =>
      c.update
        .one(
          $id(id),
          $inc(result.field -> 1L) ++ $set("updatedAt" -> nowInstant),
          upsert = true
        )
        .void

  private def read(doc: BSONDocument) =
    AiStats(
      wins = doc.getAsOpt[Long](AiResult.Win.field).getOrElse(0),
      draws = doc.getAsOpt[Long](AiResult.Draw.field).getOrElse(0),
      losses = doc.getAsOpt[Long](AiResult.Loss.field).getOrElse(0)
    )

  private[setup] def recordedResult(finish: FinishGame): Option[AiRecordedResult] =
    val game = finish.game
    for
      level <- game.aiLevel.filter(AiConfig.levels.contains)
      aiPov <- game.aiPov
      if countsTowardsStandardHistory(game)
      human = game.opponent(aiPov.player)
      user <- finish.usersBeforeGame(human.color)
      if !user.isBot && human.userId.contains(user.id)
    yield AiRecordedResult(
      userId = user.id,
      level = level,
      result =
        if game.drawn then AiResult.Draw
        else if game.winnerColor.contains(human.color) then AiResult.Win
        else AiResult.Loss
    )

  private def countsTowardsStandardHistory(game: Game) =
    game.finished && !game.aborted && game.variant.standard && game.sourceIs(_.Ai) && !game.fromPosition

  private def globalId(level: Int) = s"registered/$level"
  private def userLevelId(userId: UserId, level: Int) = s"user/${userId.value}/$level"
