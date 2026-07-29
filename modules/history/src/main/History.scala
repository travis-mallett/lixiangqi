package lila.history

import chess.IntRating
import scala.util.Success

case class History(
    standard: RatingsMap,
    ultraBullet: RatingsMap,
    bullet: RatingsMap,
    blitz: RatingsMap,
    rapid: RatingsMap,
    classical: RatingsMap,
    correspondence: RatingsMap,
    puzzle: RatingsMap
):

  def apply(pk: PerfKey): RatingsMap =
    pk match
      case PerfKey.standard => standard
      case PerfKey.bullet => bullet
      case PerfKey.blitz => blitz
      case PerfKey.rapid => rapid
      case PerfKey.classical => classical
      case PerfKey.correspondence => correspondence
      case PerfKey.puzzle => puzzle
      case PerfKey.ultraBullet => ultraBullet

object History:

  import reactivemongo.api.bson.*

  private[history] given ratingsReader: BSONDocumentReader[RatingsMap] with
    def readDocument(doc: BSONDocument) = Success:
      doc.elements
        .flatMap:
          case BSONElement(k, BSONInteger(v)) => k.toIntOption.map(_ -> IntRating(v))
          case _ => none
        .sortBy(_._1)
        .toList

  private[history] given BSONDocumentReader[History] with
    def readDocument(doc: BSONDocument) = Success:
      def ratingsMap(key: String): RatingsMap = ~doc.getAsOpt[RatingsMap](key)
      History(
        standard = ratingsMap("standard"),
        ultraBullet = ratingsMap("ultraBullet"),
        bullet = ratingsMap("bullet"),
        blitz = ratingsMap("blitz"),
        rapid = ratingsMap("rapid"),
        classical = ratingsMap("classical"),
        correspondence = ratingsMap("correspondence"),
        puzzle = ratingsMap("puzzle")
      )
