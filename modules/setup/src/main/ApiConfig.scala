package lila.setup

import chess.format.Fen
import chess.variant.{ FromPosition, Variant }
import chess.{ Rated, Clock, Speed }
import scalalib.model.Days

import lila.core.data.Template
import lila.core.game.GameRule
import lila.core.game.MoveTimeLimit
import lila.lobby.TriColor
import lila.rating.PerfType

final case class ApiConfig(
    variant: chess.variant.Variant,
    clock: Option[Clock.Config],
    moveTimeLimit: Option[MoveTimeLimit],
    days: Option[Days],
    rated: Rated,
    color: TriColor,
    position: Option[Fen.Full] = None,
    message: Option[Template],
    keepAliveStream: Boolean,
    rules: Set[GameRule] = Set.empty,
    onlyIfOpponentFollowsMe: Boolean = false,
    ruleset: Option[String] = None,
    gameVariant: lila.xiangqi.GameVariant = lila.xiangqi.GameVariant.Xiangqi
) extends lila.core.setup.VariantConfig:

  def perfType: PerfType = lila.rating.PerfType(variant, chess.Speed(days.isEmpty.so(clock)))
  def perfKey = perfType.key

  def validFen = gameVariant.validDuelPosition(variant.fromPosition, position.map(_.value))

  def isCustomPosition = position.exists(_.value != gameVariant.startFen)

  def validSpeed(isBot: Boolean) =
    !isBot || clock.forall: c =>
      Speed(c) >= Speed.Bullet

  def validRated = rated.no

  def validMoveTimeLimit = moveTimeLimit.isEmpty || clock.isDefined

  def autoVariant =
    if gameVariant.supportsCustomPosition && variant.standard && position.exists(
        _.value != gameVariant.startFen
      )
    then copy(variant = FromPosition)
    else this

object ApiConfig extends BaseConfig:

  lazy val clockLimitSeconds =
    Clock.LimitSeconds.from(Set(0, 15, 30, 45, 60, 90) ++ (2 to 180).view.map(_ * 60).toSet)

  def from(
      v: Option[Variant.LilaKey],
      cl: Option[Clock.Config],
      ml: Option[MoveTimeLimit],
      d: Option[Days],
      r: Rated,
      c: Option[String],
      pos: Option[Fen.Full],
      msg: Option[String],
      keepAliveStream: Option[Boolean],
      rules: Option[Set[GameRule]],
      onlyIfOpponentFollowsMe: Option[Boolean] = None,
      ruleset: Option[String] = None,
      gameVariant: Option[String] = None
  ) =
    ApiConfig(
      variant = chess.variant.Variant.orDefault(v),
      clock = cl,
      moveTimeLimit = ml,
      days = d,
      rated = Rated(r.yes && d.isEmpty),
      color = TriColor.orDefault(~c),
      position = pos,
      message = msg.map(Template.apply),
      keepAliveStream = ~keepAliveStream,
      rules = ~rules,
      onlyIfOpponentFollowsMe = ~onlyIfOpponentFollowsMe,
      ruleset = ruleset,
      gameVariant = gameVariant.fold(lila.xiangqi.GameVariant.Xiangqi)(
        lila.xiangqi.GameVariant.fromKey(_).fold(sys.error, identity)
      )
    ).autoVariant
