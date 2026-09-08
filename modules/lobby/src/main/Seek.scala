package lila.lobby

import chess.variant.Variant
import chess.Rated
import play.api.libs.json.*
import scalalib.ThreadLocalRandom
import scalalib.model.Days

import lila.common.Json.given
import lila.core.perf.UserWithPerfs
import lila.core.rank.{ RankCode, RankDiff, RankScore, RankSnapshot, RankTrackId }
import lila.core.rank.RankTrackId.*

// Correspondence Xiangqi, persisted while advertised in the lobby.
case class Seek(
    _id: String,
    variant: Variant.Id,
    daysPerTurn: Option[Days],
    user: LobbyUser,
    createdAt: Instant
):
  inline def id = _id

  val realVariant = Variant.orDefault(variant)

  def compatibleWith(h: Seek) =
    user.id != h.user.id &&
      compatibilityProperties == h.compatibilityProperties

  private def compatibilityProperties = (variant, daysPerTurn)

  def render: JsObject =
    Json
      .obj(
        "id" -> _id,
        "username" -> user.username,
        "rank" -> user.rank.publicCode.map(_.value),
        "variant" -> Json.obj("key" -> realVariant.key),
        "perf" -> Json.obj("key" -> "xiangqi"),
        "mode" -> Rated.No.id // protocol compatibility; correspondence challenges are casual
      )
      .add("days" -> daysPerTurn)

object Seek:

  given UserIdOf[Seek] = _.user.id

  val idSize = 8
  def makeId = ThreadLocalRandom.nextString(idSize)

  def make(
      variant: chess.variant.Variant,
      daysPerTurn: Option[Days],
      user: UserWithPerfs,
      blocking: lila.core.pool.Blocking
  ): Seek = Seek(
    _id = makeId,
    variant = variant.id,
    daysPerTurn = daysPerTurn,
    user = LobbyUser.make(user, blocking),
    createdAt = nowInstant
  )

  def renew(seek: Seek) = Seek(
    _id = makeId,
    variant = seek.variant,
    daysPerTurn = seek.daysPerTurn,
    user = seek.user,
    createdAt = nowInstant
  )

  import reactivemongo.api.bson.*
  import lila.db.dsl.{ *, given }
  import lila.db.BSON

  private given BSON[RankSnapshot] with
    def reads(r: BSON.Reader): RankSnapshot = RankSnapshot(
      track = RankTrackId.from(r.str("track")).getOrElse(RankTrackId.xiangqi),
      score = RankScore(r.int("score")),
      code = RankCode(r.str("code")),
      ordinal = r.int("ordinal"),
      catalogVersion = r.int("catalogVersion"),
      policyVersion = r.intO("policyVersion").getOrElse(lila.rating.XiangqiRank.firstPolicyVersion),
      established = r.boolD("established"),
      diff = r.intO("diff").map(RankDiff.apply),
      after = r.strO("after").map(RankCode.apply)
    )

    def writes(w: BSON.Writer, rank: RankSnapshot) = $doc(
      "track" -> rank.track.value,
      "score" -> rank.score.value,
      "code" -> rank.code.value,
      "ordinal" -> rank.ordinal,
      "catalogVersion" -> rank.catalogVersion,
      "policyVersion" -> rank.policyVersion,
      "established" -> rank.established.option(true),
      "diff" -> rank.diff.map(_.value),
      "after" -> rank.after.map(_.value)
    )

  private[lobby] given BSONDocumentHandler[LobbyUser] = Macros.handler
  private[lobby] given BSONDocumentHandler[Seek] = Macros.handler
