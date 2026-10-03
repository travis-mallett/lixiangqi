package lila.evalCache

import lila.xiangqi.Xiangqi.Game
import lila.xiangqi.XiangqiJson.given
import play.api.libs.json.*

import lila.common.Json.given
import lila.tree.{ CloudEval, Pv }

object JsonView:

  def writeEval(e: CloudEval, game: Game) =
    Json.obj(
      "fen" -> game.state.fen,
      "position" -> game.position,
      "knodes" -> e.knodes,
      "depth" -> e.depth,
      "pvs" -> JsArray(e.pvs.toList.map(writePv))
    )

  private def writePv(pv: Pv) = Json
    .obj("moves" -> pv.moves.value.toList.map(_.value).mkString(" "))
    .add("cp", pv.score.cp)
    .add("mate", pv.score.mate)
