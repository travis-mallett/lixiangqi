package lila.setup

import chess.format.Fen
import chess.{ Clock, Rated, variant as V }
import play.api.data.Forms.*
import play.api.data.format.Formats.doubleFormat
import scalalib.model.Days

import lila.common.Form.{ *, given }
import lila.core.rating.RatingRange
import lila.core.game.MoveTimeLimit
import lila.lobby.TriColor

private object Mappings:

  private case class MoveTimeLimitData(
      seconds: Int,
      firstMoves: Option[Int],
      firstSeconds: Option[Int]
  ):
    def complete = firstMoves.isDefined == firstSeconds.isDefined
    def toDomain =
      MoveTimeLimit(
        seconds,
        (firstMoves, firstSeconds).mapN(MoveTimeLimit.FirstPhase.apply)
      ).normalized

  private object MoveTimeLimitData:
    def fromDomain(limit: MoveTimeLimit) =
      MoveTimeLimitData(limit.seconds, limit.first.map(_.moves), limit.first.map(_.seconds))

  val variant = typeIn(Config.variants.toSet)
  val variantWithFen = typeIn(Config.variantsWithFen.toSet)
  val aiVariants = typeIn(Config.aiVariants.toSet)
  val variantWithVariants = typeIn(Config.variantsWithVariants.toSet)
  val variantWithFenAndVariants = typeIn(Config.variantsWithFenAndVariants.toSet)
  val boardApiVariants = Set(V.Standard.key)
  val boardApiVariantKeys = typeIn(boardApiVariants)
  val time = of[Double].verifying(HookConfig.validateTime(_))
  val increment = of[Clock.IncrementSeconds].verifying(HookConfig.validateIncrement(_))
  val moveTimeLimit = "moveTime" -> optional:
    mapping(
      "seconds" -> number.verifying(MoveTimeLimit.validSeconds),
      "firstMoves" -> optional(number.verifying(MoveTimeLimit.validFirstMoves)),
      "firstSeconds" -> optional(number.verifying(MoveTimeLimit.validSeconds))
    )(MoveTimeLimitData.apply)(data => Some((data.seconds, data.firstMoves, data.firstSeconds)))
      .verifying("Both firstMoves and firstSeconds are required", _.complete)
      .transform[MoveTimeLimit](_.toDomain, MoveTimeLimitData.fromDomain)
  val daysChoices = Days.from(List(1, 2, 3, 5, 7, 10, 14))
  val days = typeIn(daysChoices.toSet)
  def timeMode = number.verifying(TimeMode.ids contains _)
  def mode(withRated: Boolean) = optional(rawMode(withRated))
  def rawMode(withRated: Boolean) =
    number
      .verifying(Rated.byId.contains)
      .verifying(_ == Rated.No.id || withRated)
  val ratingRange = text.verifying(RatingRange.isValid)
  val color = text.verifying(TriColor.names contains _)
  val level = number.verifying(AiConfig.levels contains _)
  val speed = number.verifying(Config.speeds contains _)
  val fenField = optional:
    import lila.common.Form.fen.{ mapping, truncateMoveNumber }
    mapping.transform[Fen.Full](truncateMoveNumber, identity)
