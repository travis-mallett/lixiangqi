package lila.xiangqi

/** The 7x7 Mini Xiangqi discipline implemented by Fairy-Stockfish. */
object MiniXiangqiRules extends adjudication.RepetitionRules:
  val startFen = "rcnkncr/p1ppp1p/7/7/7/P1PPP1P/RCNKNCR w - - 0 1"
