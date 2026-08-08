package lila.setup

import chess.format.Fen
import chess.variant.{ FromPosition, Variant }
import chess.{ ByColor, Clock, Ply }
import scalalib.model.Days

import lila.core.game.{ IdGenerator, MoveTimeLimit, NewPlayer, Source }
import lila.core.user.GameUser
import lila.lobby.TriColor

final case class ApiAiConfig(
    variant: Variant,
    clock: Option[Clock.Config],
    moveTimeLimit: Option[MoveTimeLimit],
    daysO: Option[Days],
    color: TriColor,
    level: Int,
    fen: Option[Fen.Full] = None
) extends Config
    with Positional
    with WithColor:

  val strictFen = false

  val days = daysO | Days(2)
  val time = clock.so(_.limitInMinutes)
  val increment = clock.fold(Clock.IncrementSeconds(0))(_.incrementSeconds)
  val timeMode =
    if clock.isDefined then TimeMode.RealTime
    else if daysO.isDefined then TimeMode.Correspondence
    else TimeMode.Unlimited

  override def validMoveTimeLimit = moveTimeLimit.isEmpty || clock.isDefined

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
            moveTimeLimit = makeMoveTimeLimit,
            startedAtPly = Ply(xiangqiGame.state.ply),
            variant = variant
          )
    .dmap(_.start)

  def pov(user: GameUser)(using IdGenerator, NewPlayer) =
    game(user).dmap { Pov(_, creatorColor) }

  def autoVariant =
    if variant.standard && fen.exists(_.value != lila.xiangqi.Xiangqi.startFen)
    then copy(variant = FromPosition)
    else this

object ApiAiConfig extends BaseConfig:

  // lazy val clockLimitSeconds: Set[Int] = Set(0, 15, 30, 45, 60, 90) ++ (2 to 180).view.map(60 *).toSet

  def from(
      l: Int,
      v: Option[Variant.LilaKey],
      cl: Option[Clock.Config],
      ml: Option[MoveTimeLimit],
      d: Option[Days],
      c: Option[String],
      pos: Option[Fen.Full]
  ) =
    ApiAiConfig(
      variant = Variant.orDefault(v),
      clock = cl,
      moveTimeLimit = ml,
      daysO = d,
      color = TriColor.orDefault(~c),
      level = l,
      fen = pos
    ).autoVariant
