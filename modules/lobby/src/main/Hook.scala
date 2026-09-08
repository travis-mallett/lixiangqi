package lila.lobby

import chess.variant.Variant
import chess.Clock
import play.api.libs.json.*
import scalalib.ThreadLocalRandom

import lila.core.perf.UserWithPerfs
import lila.core.socket.Sri
import lila.core.game.MoveTimeLimit
import lila.core.rank.RankCode.*

// Realtime Xiangqi, kept in memory while advertised in the lobby.
case class Hook(
    id: String,
    sri: Sri, // owner socket sri
    sid: Option[String], // owner cookie (used to prevent multiple hooks)
    variant: Variant.Id,
    clock: Clock.Config,
    moveTimeLimit: Option[MoveTimeLimit],
    color: TriColor,
    user: Option[LobbyUser],
    createdAt: Instant,
    boardApi: Boolean
):

  val realVariant = Variant.orDefault(variant)

  val isAuth = user.nonEmpty

  def compatibleWith(h: Hook) =
    isAuth == h.isAuth &&
      variant == h.variant &&
      clock == h.clock &&
      moveTimeLimit == h.moveTimeLimit &&
      color.compatibleWith(h.color) &&
      (userId.isEmpty || userId != h.userId)

  def userId = user.map(_.id)
  def username = user.fold(UserName.anonymous)(_.username)
  def lame = user.so(_.lame)

  import lila.common.Json.given
  def render: JsObject = Json
    .obj(
      "id" -> id,
      "sri" -> sri,
      "clock" -> clock.show,
      "perf" -> "xiangqi",
      "t" -> clock.estimateTotalSeconds,
      "i" -> (if clock.incrementSeconds > 0 then 1 else 0)
    )
    .add("u" -> user.map(_.username))
    .add("rank" -> user.flatMap(_.rank.publicCode).map(_.value))
    .add("variant" -> realVariant.exotic.option(realVariant.key))
    .add("moveTime" -> moveTimeLimit.map: limit =>
      Json
        .obj("seconds" -> limit.seconds)
        .add("first" -> limit.first.map: first =>
          Json.obj("moves" -> first.moves, "seconds" -> first.seconds)))

object Hook:

  val idSize = 8

  def make(
      sri: Sri,
      variant: chess.variant.Variant,
      clock: Clock.Config,
      moveTimeLimit: Option[MoveTimeLimit],
      color: TriColor,
      user: Option[UserWithPerfs],
      sid: Option[String],
      blocking: lila.core.pool.Blocking,
      boardApi: Boolean = false
  ): Hook =
    new Hook(
      id = ThreadLocalRandom.nextString(idSize),
      sri = sri,
      variant = variant.id,
      clock = clock,
      moveTimeLimit = moveTimeLimit,
      color = color,
      user = user.map(LobbyUser.make(_, blocking)),
      sid = sid,
      createdAt = nowInstant,
      boardApi = boardApi
    )
