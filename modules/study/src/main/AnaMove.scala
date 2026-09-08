package lila.study

import chess.ErrorStr
import chess.format.{ Fen, Uci, UciPath }
import chess.format.pgn.SanStr
import play.api.libs.json.*

import lila.common.Json.given
import lila.tree.Branch
import lila.xiangqi.{ Xiangqi, XiangqiRules }

case class AnaMove(
    orig: chess.Square,
    dest: chess.Square,
    path: UciPath,
    chapterId: Option[StudyChapterId]
):

  def branch(fen: Fen.Full): Either[ErrorStr, Branch] =
    val nativeUci = s"${orig.key}${dest.key}".replace(":", "10")
    for
      uci <- Xiangqi.Uci.from(nativeUci).left.map(ErrorStr.apply)
      result <- XiangqiRules
        .move(Xiangqi.Position(initialFen = fen.value), uci)
        .left
        .map(ErrorStr.apply)
      treeUci <- Uci(s"${orig.key}${dest.key}").toRight(ErrorStr(s"Invalid Xiangqi move: $nativeUci"))
    yield
        Branch(
          ply = chess.Ply(result.ply),
          move = Uci.WithSan(treeUci, SanStr(result.notation)),
          fen = Fen.Full(result.fen),
          crazyData = none
        )

object AnaMove:

  def parse(o: JsObject) =
    for
      d <- o.obj("d")
      orig <- d.str("orig").flatMap(chess.Square.fromKey)
      dest <- d.str("dest").flatMap(chess.Square.fromKey)
      path <- d.get[UciPath]("path")
    yield AnaMove(
      orig = orig,
      dest = dest,
      path = path,
      chapterId = d.get[StudyChapterId]("ch")
    )
