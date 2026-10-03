package lila.study

object Node:

  val MAX_PLIES = lila.xiangqi.UciPath.maxDepth

  object BsonFields:
    val ply = "p"
    val uci = "u"
    val notation = "notation"
    val chineseNotation = "chineseNotation"
    val ruleset = "ruleset"
    val comp = "comp"
    val order = "o"
    val result = "result"
    val elapsed = "elapsed"
    val evaluationDepth = "evaluationDepth"
    val fen = "f"
    val check = "c"
    val shapes = "h"
    val comments = "co"
    val gamebook = "ga"
    val glyphs = "g"
    val score = "e"
    val clock = "l"
    val forceVariation = "fv"
