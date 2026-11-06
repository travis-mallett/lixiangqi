package lila.xiangqi

/** PyChess Manchu+ (Manchu+R), not the original one-chariot Red army. The native FEN marker preserves the
  * variant after the Banner is captured.
  */
object ManchuRules extends adjudication.RepetitionRules:
  val startFen = "m1bakab1r/9/9/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w m - 0 1"
