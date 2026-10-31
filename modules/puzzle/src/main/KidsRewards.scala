package lila.puzzle

import lila.db.AsyncColl
import lila.db.dsl.{ *, given }

/** One immutable receipt per account/puzzle. The built-in _id index makes both retries and concurrent device
  * submissions idempotent, without a transaction between a receipt and a mutable balance. Balances derive
  * from receipts.
  */
final class KidsRewards(coll: AsyncColl, puzzleExists: PuzzleId => Fu[Boolean])(using Executor):

  def award(userId: UserId, rounds: List[PuzzleRound]): Funit =
    rounds.sequentiallyVoid: round =>
      // Casual finishers can acknowledge a result without loading its puzzle.
      puzzleExists(round.id.puzzleId).flatMap: exists =>
        exists.so:
          coll(
            _.update.one(
              $id(PuzzleRound.Id(userId, round.id.puzzleId).toString),
              $doc("$setOnInsert" -> $doc("at" -> nowInstant)),
              upsert = true
            )
          ).void.recover(lila.db.ignoreDuplicateKey)

  def earned(userId: UserId): Fu[Long] =
    // User IDs cannot contain ':'. An anchored literal prefix uses the _id index.
    coll(_.countSel($doc("_id" -> $doc("$regex" -> s"^${userId}:")))).map(_.toLong)

object KidsRewards:
  // The Jiangnan map has fifteen three-solve steps and a final destination.
  // Arrival gifts derive from immutable receipts, so retries and concurrent
  // devices cannot claim them twice. Existing accounts receive them as well.
  private[puzzle] def ingots(coins: Long): Long =
    coins / 3 +
      (if coins >= 15 then 1 else 0) +
      (if coins >= 33 then 3 else 0) +
      (if coins >= 45 then 5 else 0)
