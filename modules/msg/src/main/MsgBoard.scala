package lila.msg

import play.api.libs.json.*

/** An immutable, display-only snapshot. The source is resolved when the message is sent. */
case class MsgBoard(
    frames: Vector[MsgBoard.Frame],
    orientation: String,
    start: Int,
    path: Option[String],
    inline: Option[String]
)

object MsgBoard:
  case class Shape(orig: String, dest: Option[String], brush: String)
  case class Capture(side: String, square: String, role: Option[String], concealed: Boolean, ply: Int)
  case class Frame(
      fen: String,
      ply: Int,
      turn: String,
      move: Option[String],
      check: Boolean,
      capture: Boolean,
      checkmate: Boolean,
      shapes: Vector[Shape],
      captured: Option[Capture] = None
  )

  type Resolve = (JsValue, String) => Fu[Vector[MsgBoard]]
  val unavailable: Resolve = (_, _) => fufail(MsgActionError("invalidBoard"))

  given OFormat[Shape] = Json.format
  given OFormat[Capture] = Json.format
  given OFormat[Frame] = Json.format
  given OFormat[MsgBoard] = Json.format
