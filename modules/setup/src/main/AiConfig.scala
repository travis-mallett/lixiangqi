package lila.setup

import chess.format.Fen
import chess.variant.Variant
import chess.{ ByColor, Clock, Ply }
import scalalib.model.Days

import lila.core.game.{ IdGenerator, NewPlayer, Source }
import lila.core.user.GameUser
import lila.lobby.TriColor

case class AiConfig(
    variant: chess.variant.Variant,
    timeMode: TimeMode,
    time: Double,
    increment: Clock.IncrementSeconds,
    days: Days,
    level: Int,
    color: TriColor,
    fen: Option[Fen.Full] = None
) extends Config
    with Positional
    with WithColor:

  val strictFen = true

  def >> = (variant.id, timeMode.id, time, increment, days, level, color.name, fen).some

  private def game(user: GameUser)(using
      idGenerator: IdGenerator,
      newPlayer: NewPlayer
  ): Fu[Game] =
    fenGame: xiangqiGame =>
      lila.rating.PerfType(variant, chess.Speed(makeClock))
      idGenerator.withUniqueId:
        lila.core.game
          .newGame(
            xiangqi = xiangqiGame,
            players = ByColor: c =>
              if creatorColor == c
              then newPlayer(c, user)
              else newPlayer.anon(c, level.some),
            rated = chess.Rated.No,
            source = if xiangqiGame.initialFen == lila.xiangqi.Xiangqi.startFen then Source.Ai
            else Source.Position,
            daysPerTurn = makeDaysPerTurn,
            pgnImport = None,
            clock = makeClock.map(_.toClock),
            startedAtPly = Ply(xiangqiGame.state.ply),
            variant = variant
          )
    .dmap(_.start)

  def pov(user: GameUser)(using IdGenerator, NewPlayer) =
    game(user).dmap { Pov(_, creatorColor) }

  def timeControlFromPosition =
    timeMode != TimeMode.RealTime || variant != chess.variant.FromPosition || time >= 1

object AiConfig extends BaseConfig:

  def from(
      v: Variant.Id,
      tm: Int,
      t: Double,
      i: Clock.IncrementSeconds,
      d: Days,
      level: Int,
      c: String,
      fen: Option[Fen.Full]
  ) =
    new AiConfig(
      variant = chess.variant.Variant.orDefault(v),
      timeMode = TimeMode(tm).err(s"Invalid time mode $tm"),
      time = t,
      increment = i,
      days = d,
      level = level,
      color = TriColor(c).err("Invalid color " + c),
      fen = fen
    )

  val default = AiConfig(
    variant = variantDefault,
    timeMode = TimeMode.Unlimited,
    time = 5d,
    increment = Clock.IncrementSeconds(8),
    days = Days(2),
    level = 1,
    color = TriColor.default
  )

  val levels = (1 to 8).toList

  val levelChoices = levels.map { l =>
    (l.toString, l.toString, none)
  }

  import lila.db.BSON
  import lila.db.dsl.{ *, given }

  private[setup] given BSON[AiConfig] with

    def reads(r: BSON.Reader): AiConfig =
      AiConfig(
        variant = Variant.idOrDefault(r.getO[Variant.Id]("v")),
        timeMode = TimeMode.orDefault(r.int("tm")),
        time = r.double("t"),
        increment = r.get("i"),
        days = r.get("d"),
        level = r.int("l"),
        color = TriColor.White,
        fen = r.getO[Fen.Full]("f").filter(_.value.nonEmpty)
      )

    def writes(w: BSON.Writer, o: AiConfig) =
      $doc(
        "v" -> o.variant.id,
        "tm" -> o.timeMode.id,
        "t" -> o.time,
        "i" -> o.increment,
        "d" -> o.days,
        "l" -> o.level,
        "f" -> o.fen
      )
