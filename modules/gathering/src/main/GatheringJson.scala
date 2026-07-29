package lila.gathering

import play.api.libs.json.*
import chess.format.Fen
import lila.common.Json.given

object GatheringJson:

  def position(fen: Fen.Standard): JsObject =
    Json.obj(
      "name" -> "Custom Xiangqi position",
      "fen" -> fen
    )
