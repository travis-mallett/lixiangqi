package lila.setup

import chess.{ Clock, Rated }
import chess.format.Fen
import chess.variant.{ FromPosition, Variant }
import scalalib.model.Days

import lila.core.game.GameRule
import lila.core.game.MoveTimeLimit

final case class OpenConfig(
    name: Option[String],
    variant: chess.variant.Variant,
    clock: Option[Clock.Config],
    moveTimeLimit: Option[MoveTimeLimit],
    days: Option[Days],
    rated: Rated,
    position: Option[Fen.Full],
    userIds: Option[(UserId, UserId)],
    rules: Set[GameRule] = Set.empty,
    expiresAt: Option[Instant],
    override val ruleset: Option[String] = None,
    override val gameVariant: lila.xiangqi.GameVariant = lila.xiangqi.GameVariant.Xiangqi
) extends lila.core.setup.OpenConfig:

  def perfType = lila.rating.PerfType(variant, chess.Speed(clock))

  def validFen = gameVariant.validDuelPosition(variant.fromPosition, position.map(_.value))

  def validMoveTimeLimit = moveTimeLimit.isEmpty || clock.isDefined

  def autoVariant =
    if gameVariant.supportsCustomPosition && variant.standard && position.exists(
        _.value != gameVariant.startFen
      )
    then copy(variant = FromPosition)
    else this

object OpenConfig:

  def from(
      n: Option[String],
      v: Option[Variant.LilaKey],
      cl: Option[Clock.Config],
      ml: Option[MoveTimeLimit],
      days: Option[Days],
      rated: Rated,
      pos: Option[Fen.Full],
      usernames: Option[List[UserStr]],
      rules: Option[Set[GameRule]],
      expiresAt: Option[Instant],
      ruleset: Option[String] = None,
      gameVariant: Option[String] = None
  ) =
    OpenConfig(
      name = n.map(_.trim).filter(_.nonEmpty),
      variant = Variant.orDefault(v),
      clock = cl,
      moveTimeLimit = ml,
      days = days,
      rated = rated,
      position = pos,
      userIds = usernames.map(_.map(_.id)).collect { case List(w, b) =>
        (w, b)
      },
      rules = ~rules,
      expiresAt = expiresAt,
      ruleset = ruleset,
      gameVariant = gameVariant.fold(lila.xiangqi.GameVariant.Xiangqi)(
        lila.xiangqi.GameVariant.fromKey(_).fold(sys.error, identity)
      )
    ).autoVariant
