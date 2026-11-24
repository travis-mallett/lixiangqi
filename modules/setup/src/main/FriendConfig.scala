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
    color: TriColor,
    fen: Option[Fen.Full] = None,
    override val ruleset: Option[String] = None,
    override val gameVariant: lila.xiangqi.GameVariant = lila.xiangqi.GameVariant.Xiangqi,
    rated: Rated = Rated.No
) extends HumanConfig
    with Positional
    with WithColor:

  val strictFen = false
  def accountTrack =
    lila.core.rank.RankTrackId.forMode(lila.core.rank.RankTrackId.of(gameVariant), makeDaysPerTurn.isDefined)
  def validRated = rated.no || (variant.standard && fen.isEmpty && color == TriColor.Random &&
    effectiveRuleset == gameVariant.defaultRuleset && lila.core.game.RankedGame.matchesClock(
      lila.core.rank.RankTrackId.of(gameVariant),
      makeClock,
      makeMoveTimeLimit
    ))

  def >> =
    (
      variant.id,
      timeMode.id,
      time,
      increment,
      moveTimeLimit,
      days,
      color.name,
      fen,
      ruleset,
      Some(gameVariant.key),
      rated
    ).some

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
      c: String,
      fen: Option[Fen.Full],
      ruleset: Option[String] = None,
      gameVariant: Option[String] = None,
      rated: Rated = Rated.No
  ) =
    new FriendConfig(
      variant = chess.variant.Variant.orDefault(v),
      timeMode = TimeMode(tm).err(s"Invalid time mode $tm"),
      time = t,
      rated = Rated(rated.yes && tm != TimeMode.Correspondence.id),
      increment = i,
      moveTimeLimit = ml,
      days = d,
      color = TriColor(c).err("Invalid color " + c),
      fen = fen,
      ruleset = ruleset,
      gameVariant = gameVariant.fold(lila.xiangqi.GameVariant.Xiangqi)(
        lila.xiangqi.GameVariant.fromKey(_).fold(sys.error, identity)
      )
    )

  val default = FriendConfig(
    variant = variantDefault,
    timeMode = TimeMode.Unlimited,
    time = 5d,
    increment = Clock.IncrementSeconds(8),
    moveTimeLimit = None,
    days = Days(2),
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
        color = if r.boolD("rated") then TriColor.Random else TriColor.White,
        rated = Rated(r.boolD("rated")),
        fen = r.getO[Fen.Full]("f").filter(_.value.nonEmpty),
        ruleset = r.strO("ruleset"),
        gameVariant = r
          .strO("gameVariant")
          .fold(lila.xiangqi.GameVariant.Xiangqi)(
            lila.xiangqi.GameVariant.fromKey(_).fold(sys.error, identity)
          )
      )

    def writes(w: BSON.Writer, o: FriendConfig) =
      $doc(
        "v" -> o.variant.id,
        "rated" -> o.rated.yes,
        "tm" -> o.timeMode.id,
        "t" -> o.time,
        "i" -> o.increment,
        "ml" -> o.moveTimeLimit,
        "d" -> o.days,
        "f" -> o.fen,
        "ruleset" -> o.ruleset,
        "gameVariant" -> o.gameVariant.key
      )
