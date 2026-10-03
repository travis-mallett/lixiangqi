package lila.study

import chess.ErrorStr
import play.api.libs.json.*
import lila.common.Json.given
import lila.tree.{ Branch, Root }
import lila.xiangqi.{ Xiangqi, XiangqiRules, UciPath }
import lila.xiangqi.Xiangqi.{ Square, Move }
import lila.xiangqi.XiangqiJson.given

case class AnaMove(orig: Square, dest: Square, path: UciPath, chapterId: Option[StudyChapterId]):
  def branch(root: Root): Either[ErrorStr, Branch] =
    for
      uci <- Xiangqi.Uci.from(s"${orig.key}${dest.key}").left.map(ErrorStr.apply)
      game <- root.gameAt(path).left.map(ErrorStr.apply)
      result <- XiangqiRules.move(game, uci).left.map(ErrorStr.apply)
    yield Branch(state = result.state, move = Move(uci, result.notation, result.chineseNotation))

object AnaMove:
  def parse(o: JsObject) =
    for
      d <- o.obj("d")
      orig <- d.str("orig").flatMap(Square.fromKey)
      dest <- d.str("dest").flatMap(Square.fromKey)
      path <- d.get[UciPath]("path")
    yield AnaMove(orig, dest, path, d.get[StudyChapterId]("ch"))
