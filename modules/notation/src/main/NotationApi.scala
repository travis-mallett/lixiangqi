package lila.notation

import chess.ByColor
import reactivemongo.api.bson.*

import lila.db.dsl.{ *, given }

final class NotationApi(scoreColl: Coll)(using Executor):

  private given BSONDocumentHandler[Score] = Macros.handler[Score]

  lila.common.Bus.sub[lila.core.user.UserDelete]: del =>
    scoreColl.delete.one($id(del.id)).void

  def getScore(userId: UserId): Fu[Score] =
    scoreColl.byId[Score](userId).dmap(_ | Score(userId))

  def addScore(mode: NotationMode, perspective: BoardPerspective, hits: Int)(using me: MyId): Funit =
    val side =
      perspective match
        case BoardPerspective.red => "redPerspective"
        case BoardPerspective.black => "blackPerspective"
        case BoardPerspective.both => "bothPerspectives"
    val field =
      mode match
        case NotationMode.moveFromNotation => s"${side}MoveFromNotation"
        case NotationMode.writeNotation => s"${side}WriteNotation"
    scoreColl.update
      .one(
        $id(me),
        $push(
          $doc(
            field -> $doc(
              "$each" -> $arr(hits),
              "$slice" -> -20
            )
          )
        ),
        upsert = true
      )
      .void

  def bestScores(userIds: List[UserId]): Fu[Map[UserId, ByColor[Int]]] =
    scoreColl
      .aggregateList(maxDocs = Int.MaxValue, _.sec): framework =>
        import framework.*
        Match($doc("_id".$in(userIds))) -> List(
          Project(
            $doc(
              "white" -> $doc("$max" -> "$redPerspectiveMoveFromNotation"),
              "black" -> $doc("$max" -> "$blackPerspectiveMoveFromNotation")
            )
          )
        )
      .map:
        _.flatMap: doc =>
          doc
            .getAsOpt[UserId]("_id")
            .map:
              _ -> ByColor(~doc.int("white"), ~doc.int("black"))
        .toMap
