package lila.setup

import chess.format.Fen
import chess.variant.{ FromPosition, Variant }
import chess.{ Clock, Speed }
import scalalib.model.Days

import lila.lobby.TriColor
import lila.rating.PerfType
import lila.core.game.MoveTimeLimit
import lila.xiangqi.{ Xiangqi, XiangqiRules }

private[setup] trait Config:

  // Whether or not to use a clock
  val timeMode: TimeMode

  // Clock time in minutes
  val time: Double

  // Clock increment in seconds
  val increment: Clock.IncrementSeconds

  // Optional hard ceiling on the time spent on any one move.
  val moveTimeLimit: Option[MoveTimeLimit]

  // Correspondence days per turn
  val days: Days

  // Xiangqi ruleset
  val variant: Variant

  def hasClock = timeMode == TimeMode.RealTime

  def validClock = !hasClock || clockHasTime

  def validMoveTimeLimit = moveTimeLimit.isEmpty || hasClock

  def makeMoveTimeLimit = hasClock.so(moveTimeLimit)

  def validSpeed(isBot: Boolean) =
    !isBot || makeClock.forall: c =>
      Speed(c) >= Speed.Bullet

  def clockHasTime = time + increment.value > 0

  def makeClock = hasClock.option(justMakeClock)

  protected def justMakeClock =
    Clock.Config(
      Clock.LimitSeconds((time * 60).toInt),
      if clockHasTime then increment else Clock.IncrementSeconds(1)
    )

  def makeDaysPerTurn: Option[Days] = (timeMode == TimeMode.Correspondence).option(days)

  def makeSpeed: Speed = chess.Speed(makeClock)

  def perfType: PerfType = lila.rating.PerfType(variant, makeSpeed)
  def perfKey = perfType.key

trait WithColor:
  self: Config =>

  // creator player color
  def color: TriColor

  lazy val creatorColor: Color = color.resolve()

trait Positional:
  self: Config =>

  def fen: Option[Fen.Full]

  def strictFen: Boolean

  lazy val validFen =
    variant != FromPosition || fen.exists(value => Xiangqi.Fen.isValid(value.value))

  def isCustomPosition = fen.exists(_.value != Xiangqi.startFen)

  def fenGame(builder: Xiangqi.Game => Fu[Game]): Fu[Game] =
    XiangqiRules
      .initialGame:
        fen
          .filter(_ => variant == FromPosition)
          .map(_.value)
      .fold(fufail, builder)

object Config extends BaseConfig

trait BaseConfig:
  val variants = List(chess.variant.Standard.id)
  val variantDefault = chess.variant.Standard

  val variantsWithFen = variants :+ FromPosition.id
  val aiVariants = variants :+ FromPosition.id
  val variantsWithVariants = variants
  val variantsWithFenAndVariants = variants :+ FromPosition.id

  val speeds = Speed.all.map(_.id)

  private val timeMin = 0
  private val timeMax = 180
  private val acceptableFractions = Set(1 / 4d, 1 / 2d, 3 / 4d, 3 / 2d)
  def validateTime(t: Double) =
    t >= timeMin && t <= timeMax && (t.isWhole || acceptableFractions(t))

  private val incrementMin = Clock.IncrementSeconds(0)
  private val incrementMax = Clock.IncrementSeconds(180)
  def validateIncrement(i: Clock.IncrementSeconds) = i >= incrementMin && i <= incrementMax
