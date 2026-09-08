package lila.setup

import chess.variant.Variant
import chess.{ Clock, Rated }
import scalalib.model.Days

import lila.core.perf.UserWithPerfs
import lila.lobby.{ Hook, Seek, TriColor }
import lila.core.game.MoveTimeLimit

case class HookConfig(
    variant: chess.variant.Variant,
    timeMode: TimeMode,
    time: Double, // minutes
    increment: Clock.IncrementSeconds,
    moveTimeLimit: Option[MoveTimeLimit],
    days: Days,
    color: TriColor
) extends HumanConfig:

  val rated = Rated.No

  def >> = (
    variant.id,
    timeMode.id,
    time,
    increment,
    moveTimeLimit,
    days,
    color.name.some
  ).some

  def withTimeModeString(tc: Option[String]) =
    tc match
      case Some("realTime") => copy(timeMode = TimeMode.RealTime)
      case Some("correspondence") => copy(timeMode = TimeMode.Correspondence)
      case Some("unlimited") => copy(timeMode = TimeMode.Unlimited)
      case _ => this

  def hook(
      sri: lila.core.socket.Sri,
      user: Option[UserWithPerfs],
      sid: Option[String],
      blocking: lila.core.pool.Blocking
  ): Either[Hook, Option[Seek]] =
    timeMode match
      case TimeMode.RealTime =>
        val clock = justMakeClock
        Left:
          Hook.make(
            sri = sri,
            variant = variant,
            clock = clock,
            moveTimeLimit = makeMoveTimeLimit,
            color = color,
            user = user,
            blocking = blocking,
            sid = sid
          )
      case _ =>
        Right:
          user.map: u =>
            Seek.make(
              variant = variant,
              daysPerTurn = makeDaysPerTurn,
              user = u,
              blocking = blocking
            )

  def updateFrom(game: Game) =
    val h1 = copy(
      variant = game.variant,
      timeMode = TimeMode.ofGame(game),
      time = game.clock.map(_.limitInMinutes) | time,
      increment = game.clock.map(_.incrementSeconds) | increment,
      moveTimeLimit = game.moveTimeLimit,
      days = game.daysPerTurn | days
    )
    if !h1.validClock then h1.copy(time = 1) else h1

object HookConfig extends BaseConfig:

  private given reactivemongo.api.bson.BSONHandler[MoveTimeLimit] = lila.db.BSON.moveTimeLimitHandler

  def from(
      v: Variant.Id,
      tm: Int,
      t: Double,
      i: Clock.IncrementSeconds,
      ml: Option[MoveTimeLimit],
      d: Days,
      c: Option[String]
  ) =
    new HookConfig(
      variant = chess.variant.Variant.orDefault(v),
      timeMode = TimeMode(tm).err(s"Invalid time mode $tm"),
      time = t,
      increment = i,
      moveTimeLimit = ml,
      days = d,
      color = TriColor.orDefault(c)
    )

  def default(@annotation.unused auth: Boolean): HookConfig = default

  private val default = HookConfig(
    variant = variantDefault,
    timeMode = TimeMode.RealTime,
    time = 5d,
    increment = Clock.IncrementSeconds(3),
    moveTimeLimit = None,
    days = Days(2),
    color = TriColor.default
  )

  import lila.db.BSON
  import lila.db.dsl.{ *, given }

  private[setup] given BSON[HookConfig] with

    def reads(r: BSON.Reader): HookConfig =
      HookConfig(
        variant = Variant.idOrDefault(r.getO[Variant.Id]("v")),
        timeMode = TimeMode.orDefault(r.int("tm")),
        time = r.double("t"),
        increment = r.get("i"),
        moveTimeLimit = r.contains("ml").option(r.get[MoveTimeLimit]("ml")),
        days = r.get("d"),
        color = TriColor.Random
      )

    def writes(w: BSON.Writer, o: HookConfig) =
      $doc(
        "v" -> o.variant.id,
        "tm" -> o.timeMode.id,
        "t" -> o.time,
        "i" -> o.increment,
        "ml" -> o.moveTimeLimit,
        "d" -> o.days
      )
