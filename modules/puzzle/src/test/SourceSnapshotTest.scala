package lila.puzzle

import reactivemongo.api.bson.*
import lila.db.dsl.{ *, given }
import lila.xiangqi.Xiangqi

class SourceSnapshotTest extends munit.FunSuite:
  import BsonHandlers.given

  private def document(snapshot: Option[BSONDocument]) =
    $doc(
      "_id" -> "12345",
      "gameId" -> "12345678",
      "gameSource" -> $doc("type" -> "native", "origin" -> "https://lixiangqi.com"),
      "fen" -> Xiangqi.startFen,
      "line" -> "a4a5 a7a6",
      "playback" -> $doc("objective" -> "mate", "solutions" -> Vector(Vector("a7a6"))),
      "glicko" -> $doc("r" -> 1500d, "d" -> 350d, "v" -> 0.09d),
      "plays" -> 0,
      "vote" -> 1d,
      "themes" -> List("mate"),
      "retired" -> false
    ) ++ snapshot.fold($empty)(s => $doc("sourceSnapshot" -> s))

  private val snapshot = $doc(
    "initialFen" -> Xiangqi.startFen,
    "moves" -> List("a4a5", "a7a6"),
    "players" -> List.empty[BSONDocument]
  )

  test("source snapshots are required rather than fetched through a legacy source path"):
    val reader = summon[BSONDocumentReader[Puzzle]]
    assert(reader.readDocument(document(Some(snapshot))).isSuccess)
    assert(reader.readDocument(document(None)).isFailure)

  test("invalid snapshot moves fail without silently shortening history"):
    val invalid = $doc(
      "initialFen" -> Xiangqi.startFen,
      "moves" -> List("a4a5", "invalid"),
      "players" -> List.empty[BSONDocument]
    )
    assert(summon[BSONDocumentReader[Puzzle]].readDocument(document(Some(invalid))).isFailure)
