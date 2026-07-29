package lila.xiangqi

import munit.FunSuite
import play.api.libs.json.Json

import Xiangqi.*
import XiangqiJson.given

class XiangqiJsonTest extends FunSuite:

  test("reads the native position JSON contract"):
    val json = Json.parse("""{
      "variant":"xiangqi",
      "fen":"rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
      "ply":0,"turn":"red","legalMoves":["a1a2","a1a3"],"check":false,
      "insufficientMaterial":false,"gameResult":"*",
      "immediateEnd":{"ended":false,"result":0},
      "optionalEnd":{"ended":false,"result":0}
    }""")
    val state = json.as[State]
    assertEquals(state.variant, "xiangqi")
    assertEquals(state.turn, Side.Red)
    assertEquals(state.legalMoves.map(_.value), Vector("a1a2", "a1a3"))

  test("reads authoritative move sound events"):
    val json = Json.parse("""{
      "move":"a1a2","notation":"R9+1","chineseNotation":"车九进一","capture":true,"checkmate":false,
      "variant":"xiangqi","fen":"next","ply":1,"turn":"black","legalMoves":[],"check":false,
      "insufficientMaterial":false,"gameResult":"*",
      "immediateEnd":{"ended":false,"result":0},
      "optionalEnd":{"ended":false,"result":0}
    }""")
    val move = json.as[MoveResult]
    assert(move.capture)
    assert(!move.checkmate)

  test("reads a recursive imported variation tree"):
    val json = Json.parse("""{
      "initialFen":"rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
      "headers":{"red":"A","black":"B"},
      "state":{"variant":"xiangqi","fen":"root","ply":0,"turn":"red","legalMoves":[],"check":false,
        "insufficientMaterial":false,"gameResult":"*","immediateEnd":{"ended":false,"result":0},
        "optionalEnd":{"ended":false,"result":0}},
      "children":[{"move":"a4a5","notation":"P9+1","chineseNotation":"兵九进一","state":{"variant":"xiangqi","fen":"next",
        "ply":1,"turn":"black","legalMoves":[],"check":false,"insufficientMaterial":false,
        "gameResult":"*","immediateEnd":{"ended":false,"result":0},"optionalEnd":{"ended":false,"result":0}},
        "children":[]}]
    }""")
    val tree = json.as[ImportedMoveTree]
    assertEquals(tree.children.head.move.value, "a4a5")
    assertEquals(tree.children.head.notation, "P9+1")
    assertEquals(tree.headers.get("red"), Some("A"))

  test("reads cloud principal variations with follow-up notation"):
    val json = Json.parse("""{
      "available":true,
      "source":"Xiangqi Cloud Database",
      "sourceUrl":"https://www.chessdb.cn/cloudbook_info_en.html",
      "moves":[{
        "move":"h1g3","notation":"H2+3","score":12,"rank":2,"winrate":52.5,"note":"!",
        "pvMoves":["h1g3","h10g8"],"wxfMoves":["H2+3","H8+7"]
      }]
    }""")
    val result = json.as[ExplorerResult]
    assertEquals(result.moves.head.pvMoves.map(_.value), Vector("h1g3", "h10g8"))
    assertEquals(result.moves.head.wxfMoves, Vector("H2+3", "H8+7"))
