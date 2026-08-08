package lila.setup

import chess.format.Fen
import chess.variant.Variant
import chess.{ Clock, Rated }
import scalalib.model.Days

import lila.lobby.TriColor
import lila.core.game.MoveTimeLimit

case class FriendConfig(
    variant: chess.variant.Variant,
    timeMode: TimeMode,
    time: Double,
    increment: Clock.IncrementSeconds,
    moveTimeLimit: Option[MoveTimeLimit],
    days: Days,
    rated: Rated,
    color: TriColor,
    fen: Option[Fen.Full] = None
) extends HumanConfig
    with Positional
    with WithColor:

  val strictFen = false

  def >> =
    (variant.id, timeMode.id, time, increment, moveTimeLimit, days, rated.id.some, color.name, fen).some

  def isPersistent = timeMode == TimeMode.Unlimited || timeMode == TimeMode.Correspondence

object FriendConfig extends BaseConfig:

  private given reactivemongo.api.bson.BSONHandler[MoveTimeLimit] = lila.db.BSON.moveTimeLimitHandler

  def from(
      v: Variant.Id,
      tm: Int,
      t: Double,
      i: Clock.IncrementSeconds,
      ml: Option[MoveTimeLimit],
      d: Days,
      m: Option[Int],
      c: String,
      fen: Option[Fen.Full]
  ) =
    new FriendConfig(
      variant = chess.variant.Variant.orDefault(v),
      timeMode = TimeMode(tm).err(s"Invalid time mode $tm"),
      time = t,
      increment = i,
      moveTimeLimit = ml,
      days = d,
      rated = m.fold(Rated.default)(Rated.orDefault),
      color = TriColor(c).err("Invalid color " + c),
      fen = fen
    )

  val default = FriendConfig(
    variant = variantDefault,
    timeMode = TimeMode.Unlimited,
    time = 5d,
    increment = Clock.IncrementSeconds(8),
    moveTimeLimit = None,
    days = Days(2),
    rated = Rated.default,
    color = TriColor.default
  )

  import lila.db.BSON
  import lila.db.dsl.{ *, given }

  private[setup] given BSON[FriendConfig] with

    def reads(r: BSON.Reader): FriendConfig =
      FriendConfig(
        variant = Variant.idOrDefault(r.getO[Variant.Id]("v")),
        timeMode = TimeMode.orDefault(r.int("tm")),
        time = r.double("t"),
        increment = r.get("i"),
        moveTimeLimit = r.contains("ml").option(r.get[MoveTimeLimit]("ml")),
        days = r.get("d"),
        rated = Rated.orDefault(r.int("m")),
        color = TriColor.White,
        fen = r.getO[Fen.Full]("f").filter(_.value.nonEmpty)
      )

    def writes(w: BSON.Writer, o: FriendConfig) =
      $doc(
        "v" -> o.variant.id,
        "tm" -> o.timeMode.id,
        "t" -> o.time,
        "i" -> o.increment,
        "ml" -> o.moveTimeLimit,
        "d" -> o.days,
        "m" -> o.rated.id,
        "f" -> o.fen
      )
