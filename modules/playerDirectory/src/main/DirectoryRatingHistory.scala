package lila.playerDirectory

import reactivemongo.api.bson.Macros.Annotations.Key
import java.time.YearMonth
import play.api.libs.json.*
import monocle.syntax.all.*
import lila.core.playerDirectory.RatingCategory
import lila.core.playerDirectory.PlayerId
import chess.rating.Elo

case class DirectoryRatingHistory(
    @Key("_id") id: PlayerId,
    standard: DirectoryRatingHistory.RatingPoints,
    rapid: DirectoryRatingHistory.RatingPoints,
    blitz: DirectoryRatingHistory.RatingPoints
):
  import DirectoryRatingHistory.RatingPoints

  def focusTC(tc: RatingCategory) = tc match
    case RatingCategory.standard => this.focus(_.standard)
    case RatingCategory.rapid => this.focus(_.rapid)
    case RatingCategory.blitz => this.focus(_.blitz)

  def set(date: YearMonth, tc: RatingCategory, elo: Elo): DirectoryRatingHistory =
    focusTC(tc).modify(DirectoryRatingHistory.set(_, date, elo))

  def set(date: YearMonth, elos: Map[RatingCategory, Elo]): DirectoryRatingHistory =
    elos.foldLeft(this):
      case (hist, (tc, elo)) => hist.set(date, tc, elo)

  def allRatings: Map[RatingCategory, RatingPoints] =
    Map(
      RatingCategory.standard -> standard,
      RatingCategory.rapid -> rapid,
      RatingCategory.blitz -> blitz
    )

  def toJson = Json.toJsObject:
    allRatings.map: (tc, points) =>
      (tc.toString, DirectoryRatingPoint.raw(points))

private opaque type DirectoryRatingPoint = Int // 2021031800
private object DirectoryRatingPoint extends OpaqueInt[DirectoryRatingPoint]:
  def apply(date: YearMonth, elo: Elo): DirectoryRatingPoint =
    (date.toString.replace("-", "") + "%04d".format(elo.value)).toInt
  extension (point: DirectoryRatingPoint)
    def date: YearMonth =
      val dateNum = point.value / 10000
      YearMonth.of(dateNum / 100, dateNum % 100)
    def elo: Elo = Elo(point % 10000)

object DirectoryRatingHistory:

  type RatingPoints = List[DirectoryRatingPoint] // chronological order, oldest first

  def empty(id: PlayerId): DirectoryRatingHistory = DirectoryRatingHistory(id, Nil, Nil, Nil)

  private def set(points: RatingPoints, at: YearMonth, elo: Elo): RatingPoints =
    val cleaned = points.filterNot(_.date == at)
    compress((DirectoryRatingPoint(at, elo) :: cleaned))

  // keep the first and last of each streak of identical ratings
  private def compress(points: RatingPoints): RatingPoints =
    if points.sizeIs < 3 then points
    else
      val sorted = points.sortBy(DirectoryRatingPoint.raw)
      val middle = sorted
        .sliding(3)
        .foldLeft(List.empty[DirectoryRatingPoint]):
          case (acc, List(a, b, c)) =>
            if a.elo == b.elo && b.elo == c.elo then acc else b :: acc
          case (acc, _) => acc
      sorted.headOption.toList ::: middle.reverse ::: sorted.lastOption.toList
