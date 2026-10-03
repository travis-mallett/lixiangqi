package lila.evalCache

import lila.xiangqi.Xiangqi.Uci
import chess.eval.*
import reactivemongo.api.bson.*

import scala.util.{ Success, Try }

import lila.db.dsl.given
import lila.tree.{ CloudEval, Moves, Pv }

private object BSONHandlers:

  given BSONReader[NonEmptyList[Pv]] = new:

    private def scoreRead(str: String): Option[Score] =
      if str.startsWith("#") then str.drop(1).toIntOption.map(Score.mate)
      else str.toIntOption.map(Score.cp)

    private def movesRead(str: String): Option[Moves] = Moves.from:
      str.split(" ", -1).toList.traverse(Uci.from(_).toOption).flatMap(_.toNel)

    private val scoreSeparator = ':'
    private val pvSeparator = '/'
    def readTry(bs: BSONValue) =
      bs match
        case BSONString(value) =>
          Try {
            value.split(pvSeparator).toList.map { pvStr =>
              pvStr.split(scoreSeparator) match
                case Array(score, moves) =>
                  Pv(
                    scoreRead(score).err(s"Invalid score $score"),
                    movesRead(moves).err(s"Invalid moves $moves")
                  )
                case x => sys.error(s"Invalid PV $pvStr: ${x.toList} (in $value)")
            }
          }.flatMap:
            _.toNel.toTry(s"Empty PVs $value")
        case b => lila.db.BSON.handlerBadType[NonEmptyList[Pv]](b)

  given BSONHandler[Id] = lila.db.dsl.stringAnyValHandler[Id](_.value, Id.apply)
  given BSONDocumentReader[CloudEval] = Macros.reader
  given BSONDocumentReader[EvalCacheEntry] = Macros.reader
