package lila.threeKingdoms

import reactivemongo.api.WriteConcern
import lila.db.dsl.{ *, given }

/** The receipt and all three profile counters commit together. Recovery may safely replay this after a crash
  * or an uncertain commit, without a growing receipt array on each account.
  */
final class GameAccounting(repo: GameRepo, users: lila.user.UserRepo)(using Executor):
  def finish(game: KingdomGame, attempts: Int = 3): Funit =
    require(game.position.finished)
    repo.coll.db
      .startSession()
      .flatMap: session =>
        val result = session
          .startTransaction(
            Some(WriteConcern(WriteConcern.Majority, j = true, fsync = false, wtimeout = Some(10000)))
          )
          .flatMap: db =>
            val games: Coll = db.collection(repo.coll.name)
            games
              .find($id(game.id) ++ $doc("accounted" -> true), $id(true).some)
              .one[Bdoc]
              .map(_.isDefined)
              .flatMap:
                case true => funit
                case false =>
                  for
                    _ <- game.userIds.sequentiallyVoid: id =>
                      val player = game.playerOf(id).get
                      val result = if game.position.placement(player).contains(1d) then 1
                      else if game.position.eliminated.exists(_.player == player) then -1
                      else 0
                      users.countFinishedGameInTransaction(id, game.rated, result, db)
                    _ <- games.update.one($id(game.id), $set("accounted" -> true))
                  yield ()
              .flatMap(_ => db.commitTransaction().void)
        result.transformWith:
          case scala.util.Success(_) => session.endSession().void
          case scala.util.Failure(error) =>
            session
              .abortTransaction()
              .recover { case _ => session }
              .flatMap(_.endSession())
              .recover { case _ => session }
              .flatMap(_ => if attempts > 1 then finish(game, attempts - 1) else fufail(error))
