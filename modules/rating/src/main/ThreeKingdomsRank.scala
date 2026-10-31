package lila.rating

import lila.core.rank.{ RankCode, RankDiff, RankSnapshot, RankTrackId }
import lila.core.rank.RankCode.*
import lila.core.rank.RankDiff.*

/** Independent assessment track. Each placement is compared with both opponents, once. Equal-strength results
  * are +20 / 0 / -20; tied survivors split first and second.
  */
object ThreeKingdomsRank extends RankPolicy:
  val catalog = JieqiRank.catalog.copy(
    track = RankTrackId.threeKingdoms,
    levels =
      JieqiRank.catalog.levels.map(level => level.copy(code = RankCode("三" + level.code.value.drop(1))))
  )
  override protected def matchingGroup(ordinal: Int): Int = ordinal.min(26) / 3

  def settleThree(snapshots: Vector[RankSnapshot], places: Vector[Double]): Either[String, Vector[RankDiff]] =
    if snapshots.size != 3 || places.size != 3 ||
      !Set(Vector(1d, 2d, 3d), Vector(1.5d, 1.5d, 3d), Vector(2d, 2d, 2d)).contains(places.sorted)
    then Left("Invalid three-player result")
    else
      val pairs = for
        a <- (0 until 3).toVector
        b <- (a + 1 until 3).toVector
      yield settle(
        snapshots(a),
        snapshots(b),
        chess.Outcome(
          if places(a) == places(b) then None
          else Some(if places(a) < places(b) then chess.Color.White else chess.Color.Black)
        )
      ).map(s => (a, b, s.red, s.black))
      pairs.collectFirst { case Left(error) => error } match
        case Some(error) => Left(error)
        case None =>
          val diffs = Array.fill(3)(0)
          pairs.foreach(_.foreach: (a, b, first, second) =>
            diffs(a) += first.value
            diffs(b) += second.value)
          Right(diffs.toVector.map(RankDiff(_)))
