package lila.game

import scala.util.Try

import chess.*
import org.lichess.compression.clock.Encoder as ClockEncoder

import lila.db.ByteArray

object BinaryFormat:

  object clockHistory:

    def writeSide(start: Centis, times: Vector[Centis], flagged: Boolean) =
      val timesToWrite = if flagged then times.dropRight(1) else times
      ByteArray(ClockEncoder.encode(Centis.raw(timesToWrite).to(Array), start.centis))

    def readSide(start: Centis, ba: ByteArray, flagged: Boolean) =
      val decoded: Vector[Centis] =
        Centis.from(ClockEncoder.decode(ba.value, start.centis).to(Vector))
      if flagged then decoded :+ Centis(0) else decoded

    def read(start: Centis, bw: ByteArray, bb: ByteArray, flagged: Option[Color]) =
      Try {
        ByColor(
          readSide(start, bw, flagged.has(White)),
          readSide(start, bb, flagged.has(Black))
        )
      }.fold(
        e =>
          logger.warn(s"Exception decoding clock history", e); none
        ,
        some
      )

  object moveTime:

    private type MT = Int // centiseconds
    private val size = 16
    private val buckets =
      List(10, 50, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 4000, 6000)
    private val encodeCutoffs = buckets
      .zip(buckets.tail)
      .map((i1, i2) => (i1 + i2) / 2)
      .toVector

    private val decodeMap: Map[Int, MT] = buckets.mapWithIndex((x, i) => i -> x).toMap

    def write(mts: Vector[Centis]): Array[Byte] =
      def enc(mt: Centis) = encodeCutoffs.search(mt.centis).insertionPoint
      mts
        .grouped(2)
        .map:
          case Vector(a, b) => (enc(a) << 4) + enc(b)
          case Vector(a) => enc(a) << 4
          case v => sys.error(s"moveTime.write unexpected $v")
        .map(_.toByte)
        .toArray

    def read(ba: Array[Byte], turns: Ply): Vector[Centis] = Centis.from:
      def dec(x: Int) = decodeMap.getOrElse(x, decodeMap(size - 1))
      ba.map(toInt)
        .flatMap(k => Array(dec(k >> 4), dec(k & 15)))
        .view
        .take(turns.value)
        .toVector

  final class clock(start: Timestamp):

    def legacyElapsed(clock: Clock, color: Color) =
      clock.limit - clock.players(color).remaining

    def computeRemaining(config: Clock.Config, legacyElapsed: Centis) =
      config.limit - legacyElapsed

    def write(clock: Clock): ByteArray = ByteArray:
      Array(writeClockLimit(clock.limitSeconds.value), clock.incrementSeconds.value.toByte) ++
        writeSignedInt24(legacyElapsed(clock, White).centis) ++
        writeSignedInt24(legacyElapsed(clock, Black).centis) ++
        clock.timer.fold(Array.empty[Byte])(writeTimer)

    def read(ba: ByteArray, whiteBerserk: Boolean, blackBerserk: Boolean): Color => Clock =
      color =>
        val ia = ba.value.map(toInt)

        // ba.size might be greater than 12 with 5 bytes timers
        // ba.size might be 8 if there was no timer.
        // #TODO remove 5 byte timer case! But fix the DB first!
        val timer = (ia.lengthIs == 12).so(readTimer(readInt(ia(8), ia(9), ia(10), ia(11))))

        ia match
          case Array(b1, b2, b3, b4, b5, b6, b7, b8, _*) =>
            val config = Clock.Config(clock.readClockLimit(b1), Clock.IncrementSeconds(b2))
            val legacyWhite = Centis(readSignedInt24(b3, b4, b5))
            val legacyBlack = Centis(readSignedInt24(b6, b7, b8))
            val players = ByColor((whiteBerserk, legacyWhite), (blackBerserk, legacyBlack))
              .map: (berserk, legacy) =>
                ClockPlayer
                  .withConfig(config)
                  .copy(berserk = berserk)
                  .setRemaining(computeRemaining(config, legacy))
            Clock(
              config = config,
              color = color,
              players = players,
              timer = timer
            )
          case _ => sys.error(s"BinaryFormat.clock.read invalid bytes: ${ba.showBytes}")

    private def writeTimer(timer: Timestamp) =
      val centis = (timer - start).centis
      /*
       * A zero timer is resolved by `readTimer` as the absence of a timer.
       * As a result, a clock that is started with a timer = 0
       * resolves as a clock that is not started.
       * This can happen when the clock was started at the same time as the game
       * For instance in simuls
       */
      val nonZero = centis.atLeast(1)
      writeInt(nonZero)

    private def readTimer(l: Int) =
      Option.when(l != 0)(start + Centis(l))

    private def writeClockLimit(limit: Int): Byte =
      // The database expects a byte for a limit, and this is limit / 60.
      // For 0.5+0, this does not give a round number, so there needs to be
      // an alternative way to describe 0.5.
      // The max limit where limit % 60 == 0, returns 180 for limit / 60
      // So, for the limits where limit % 30 == 0, we can use the space
      // from 181-255, where 181 represents 0.25 and 182 represents 0.50...
      (if limit % 60 == 0 then limit / 60 else limit / 15 + 180).toByte

  object clock:
    def apply(start: Instant) = new clock(Timestamp(start.toMillis))

    def readConfig(ba: ByteArray): Option[Clock.Config] =
      ba.value match
        case Array(b1, b2, _*) => Clock.Config(readClockLimit(b1), Clock.IncrementSeconds(b2)).some
        case _ => None

    def readClockLimit(i: Int) = Clock.LimitSeconds(if i < 181 then i * 60 else (i - 180) * 15)

  inline private def toInt(inline b: Byte): Int = b & 0xff

  def writeInt24(int: Int) =
    val i = if int < (1 << 24) then int else 0
    Array((i >>> 16).toByte, (i >>> 8).toByte, i.toByte)

  private val int23Max = 1 << 23
  def writeSignedInt24(int: Int) =
    val i = if int < 0 then int23Max - int else math.min(int, int23Max)
    writeInt24(i)

  def readInt24(b1: Int, b2: Int, b3: Int) = (b1 << 16) | (b2 << 8) | b3

  def readSignedInt24(b1: Int, b2: Int, b3: Int) =
    val i = readInt24(b1, b2, b3)
    if i > int23Max then int23Max - i else i

  def writeInt(i: Int) =
    Array(
      (i >>> 24).toByte,
      (i >>> 16).toByte,
      (i >>> 8).toByte,
      i.toByte
    )

  def readInt(b1: Int, b2: Int, b3: Int, b4: Int) =
    (b1 << 24) | (b2 << 16) | (b3 << 8) | b4
