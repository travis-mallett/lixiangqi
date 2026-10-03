package lila.study

import chess.format.pgn.PgnStr

opaque type MultiPgn = List[PgnStr]

object MultiPgn extends TotalWrapper[MultiPgn, List[PgnStr]]:

  def split(str: PgnStr, max: Max): MultiPgn =
    lila.xiangqi.XiangqiNotation
      .splitDocuments(str.value, max.value)
      .fold(error => throw IllegalArgumentException(error), values => PgnStr.from(values.toList))

  extension (pgns: MultiPgn) def toPgnStr = PgnStr(pgns.mkString("\n\n"))
