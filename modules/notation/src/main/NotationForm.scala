package lila.notation

import play.api.data.*
import play.api.data.Forms.*

object NotationForm:

  val score = Form(
    mapping(
      "mode" -> lila.common.Form
        .trim(text)
        .verifying(m => NotationMode.find(m).isDefined)
        .transform[NotationMode](m => NotationMode.find(m).get, _.toString),
      "perspective" -> lila.common.Form
        .trim(text)
        .verifying(p => BoardPerspective.find(p).isDefined)
        .transform[BoardPerspective](p => BoardPerspective.find(p).get, _.toString),
      "score" -> number(min = 0, max = 100)
    )(ScoreData.apply)(unapply)
  )

  case class ScoreData(mode: NotationMode, perspective: BoardPerspective, score: Int)
