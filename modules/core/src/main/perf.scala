package lila.core

import _root_.chess.variant.Variant
import _root_.chess.{ Speed, IntRating }
import _root_.chess.rating.IntRatingDiff
import _root_.chess.rating.glicko.Glicko
import monocle.syntax.all.*
import monocle.syntax.AppliedPLens

import lila.core.userId.{ UserId, UserIdOf }

object perf:

  opaque type PerfKey = String
  object PerfKey:
    val bullet: PerfKey = "bullet"
    val blitz: PerfKey = "blitz"
    val rapid: PerfKey = "rapid"
    val classical: PerfKey = "classical"
    val correspondence: PerfKey = "correspondence"
    val standard: PerfKey = "standard"
    val ultraBullet: PerfKey = "ultraBullet"
    val puzzle: PerfKey = "puzzle"
    val list: List[PerfKey] = List(
      bullet,
      blitz,
      rapid,
      classical,
      correspondence,
      standard,
      ultraBullet,
      puzzle
    )
    val all: Set[PerfKey] = list.toSet
    def keyIdMap: Map[PerfKey, PerfId] = Map(
      ultraBullet -> 0,
      bullet -> 1,
      blitz -> 2,
      rapid -> 6,
      classical -> 3,
      correspondence -> 4,
      standard -> 5,
      puzzle -> 20
    )

    extension (key: PerfKey)
      def value: String = key
      def id: PerfId = keyIdMap(key)

    given Show[PerfKey] = _.value
    given SameRuntime[PerfKey, String] = _.value
    given Eq[PerfKey] = Eq.by(_.value)

    def apply(key: String): Option[PerfKey] = Option.when(all.contains(key))(key)

    def keyToId(key: PerfKey): PerfId = keyIdMap(key)

    def standardBySpeed(speed: Speed): PerfKey = speed match
      case Speed.Bullet => bullet
      case Speed.Blitz => blitz
      case Speed.Rapid => rapid
      case Speed.Classical => classical
      case Speed.Correspondence => correspondence
      case Speed.UltraBullet => ultraBullet

    def apply(variant: Variant, speed: Speed): PerfKey =
      byVariant(variant) | standardBySpeed(speed)

    // Standard is the only registered Xiangqi ruleset today.
    def byVariant(@annotation.unused variant: Variant): Option[PerfKey] = none

  opaque type PerfId = Int
  object PerfId extends OpaqueInt[PerfId]

  trait PerfStatApi:
    def highestRating(user: UserId, perfKey: PerfKey): Fu[Option[IntRating]]

  case class Perf(glicko: Glicko, nb: Int, recent: List[IntRating], latest: Option[Instant]):
    export glicko.{ intRating, intDeviation, provisional }
    export latest.{ isEmpty, nonEmpty }

    def keyed(key: PerfKey) = KeyedPerf(key, this)

    def progress: IntRatingDiff = {
      for
        head <- recent.headOption
        last <- recent.lastOption
      yield IntRatingDiff(head.value - last.value)
    } | IntRatingDiff(0)

  case class KeyedPerf(key: PerfKey, perf: Perf)

  case class PuzPerf(score: Int, runs: Int):
    def nonEmpty = runs > 0
    def option = nonEmpty.option(this)

  case class UserPerfs(
      id: UserId,
      bullet: Perf,
      blitz: Perf,
      rapid: Perf,
      classical: Perf,
      correspondence: Perf,
      standard: Perf,
      ultraBullet: Perf,
      puzzle: Perf,
      storm: PuzPerf,
      racer: PuzPerf,
      streak: PuzPerf
  ):
    def apply(key: PerfKey): Perf = key match
      case "bullet" => bullet
      case "blitz" => blitz
      case "rapid" => rapid
      case "classical" => classical
      case "correspondence" => correspondence
      case "ultraBullet" => ultraBullet
      case "standard" => standard
      case "puzzle" => puzzle
      // impossible because PerfKey can't be instantiated with arbitrary values
      case key => sys.error(s"Unknown perf key: $key")

    def keyed(key: PerfKey): KeyedPerf = KeyedPerf(key, apply(key))

    def focusKey(key: PerfKey): AppliedPLens[UserPerfs, UserPerfs, Perf, Perf] = key match
      case "bullet" => this.focus(_.bullet)
      case "blitz" => this.focus(_.blitz)
      case "rapid" => this.focus(_.rapid)
      case "classical" => this.focus(_.classical)
      case "correspondence" => this.focus(_.correspondence)
      case "ultraBullet" => this.focus(_.ultraBullet)
      case "standard" => this.focus(_.standard)
      case "puzzle" => this.focus(_.puzzle)
      // impossible because PerfKey can't be instantiated with arbitrary values
      case key => sys.error(s"Unknown perf key: $key")

  case class UserWithPerfs(user: lila.core.user.User, perfs: UserPerfs):
    export user.*
  object UserWithPerfs:
    given UserIdOf[UserWithPerfs] = _.id
