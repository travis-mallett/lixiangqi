package lila.db

import reactivemongo.api.bson.*
import scala.util.Try
import lila.db.dsl.{ *, given }
import lila.xiangqi.Xiangqi
import lila.xiangqi.adjudication.Ruleset

/** Shared persistence codec for native analysis positions, including public chance outcomes. */
object XiangqiBson:
  private given BSONHandler[Xiangqi.Uci] = tryHandler(
    { case BSONString(value) => Try(Xiangqi.Uci.unsafe(value)) },
    move => BSONString(move.value)
  )
  private given BSONHandler[Ruleset] = tryHandler(
    { case BSONString(value) => Try(Ruleset.fromKey(value).fold(sys.error, identity)) },
    ruleset => BSONString(ruleset.key)
  )
  private given BSONHandler[Vector[Option[String]]] = tryHandler(
    { case array: BSONArray =>
      Try(array.values.map {
        case BSONString(role) => Some(role)
        case BSONNull => None
        case _ => throw IllegalArgumentException("Invalid reveal history")
      }.toVector)
    },
    values => BSONArray(values.map(_.fold[BSONValue](BSONNull)(BSONString.apply)))
  )
  given positionHandler: lila.db.BSON[Xiangqi.Position] with
    def reads(r: lila.db.BSON.Reader) = Xiangqi.Position(
      initialFen = r.str("initialFen"),
      moves = r.get[Vector[Xiangqi.Uci]]("moves"),
      ruleset = r.get[Ruleset]("ruleset"),
      reveals = if r.contains("reveals") then r.get[Vector[Option[String]]]("reveals") else Vector.empty,
      knownCaptures =
        if r.contains("knownCaptures") then r.get[Map[String, String]]("knownCaptures") else Map.empty
    )
    def writes(w: lila.db.BSON.Writer, position: Xiangqi.Position) = $doc(
      "initialFen" -> position.initialFen,
      "moves" -> position.moves,
      "ruleset" -> position.ruleset,
      "reveals" -> Option.when(position.reveals.nonEmpty)(position.reveals),
      "knownCaptures" -> Option.when(position.knownCaptures.nonEmpty)(position.knownCaptures)
    )
