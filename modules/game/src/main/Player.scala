package lila.game

import chess.{ ByColor, Color, IntRating, PlayerName, Ply }
import chess.rating.RatingProvisional

import lila.core.game.{ Blurs, LightGame, Player }
import lila.core.rank.{ RankCode, RankDiff, RankScore, RankSnapshot, RankTrackId }
import lila.core.rank.RankTrackId.*
import lila.core.user.WithPerf
import lila.game.Blurs.{ nonEmpty, given }

object Player:

  extension (p: Player)
    def nameSplit: Option[(PlayerName, Option[Int])] =
      PlayerName
        .raw(p.name)
        .map:
          case Player.nameSplitRegex(n, r) => PlayerName(n.trim) -> r.toIntOption
          case n => PlayerName(n) -> none

  private val nameSplitRegex = """([^(]++)\((\d++)\)""".r

  def makeAnon(color: Color, aiLevel: Option[Int] = None): Player = new Player(
    id = IdGenerator.player(color),
    color = color,
    aiLevel = aiLevel
  )

  def make(color: Color, userPerf: (UserId, Perf)): Player = make(
    color = color,
    userId = userPerf._1,
    rating = userPerf._2.intRating,
    provisional = userPerf._2.glicko.provisional
  )

  def make(
      color: Color,
      userId: UserId,
      rating: IntRating,
      provisional: RatingProvisional
  ): Player =
    new Player(
      id = IdGenerator.player(color),
      color = color,
      aiLevel = none,
      userId = userId.some,
      rating = rating.some,
      provisional = provisional
    )

  def make(color: Color, userId: UserId, rank: RankSnapshot): Player =
    new Player(
      id = IdGenerator.player(color),
      color = color,
      aiLevel = none,
      userId = userId.some,
      rank = rank.some
    )

  def make(color: Color, user: Option[WithPerf]): Player =
    user.fold(makeAnon(color)): u =>
      make(
        color,
        u.id,
        u.rank.getOrElse(lila.rating.XiangqiRank.snapshot(lila.rating.XiangqiRank.initial))
      )

  def makeImported(
      color: Color,
      name: Option[PlayerName],
      rating: Option[IntRating]
  ): Player =
    new Player(
      id = IdGenerator.player(color),
      color = color,
      aiLevel = none,
      name = name.orElse(PlayerName("?").some),
      rating = rating
    )

  case class HoldAlert(ply: Ply, mean: Int, sd: Int):
    def suspicious = HoldAlert.suspicious(ply)
  object HoldAlert:
    type Map = ByColor[Option[HoldAlert]]
    val emptyMap: Map = ByColor(none, none)
    def suspicious(ply: Ply): Boolean = ply >= 16 && ply <= 40
    def suspicious(m: Map): Boolean = m.exists { _.exists(_.suspicious) }

  import reactivemongo.api.bson.*
  import lila.db.dsl.{ *, given }

  given BSONDocumentHandler[HoldAlert] = Macros.handler

  object BSONFields:

    val aiLevel = "ai"
    val isOfferingDraw = "od"
    val proposeTakebackAt = "ta"
    val rating = "e"
    val ratingDiff = "d"
    val provisional = "p"
    val rank = "rk"
    val blursBits = "l"
    val holdAlert = "h"
    val berserk = "be"
    val blindfold = "bf"
    val name = "na"

  def from(light: LightGame, color: Color, ids: String, doc: Bdoc): Player =
    import BSONFields.*
    val p = light.player(color)
    new Player(
      id = GamePlayerId(color.fold(ids.take(4), ids.drop(4))),
      color = p.color,
      aiLevel = p.aiLevel,
      isWinner = light.win.map(_ == color),
      isOfferingDraw = doc.booleanLike(isOfferingDraw).getOrElse(false),
      proposeTakebackAt = Ply(doc.int(proposeTakebackAt).getOrElse(0)),
      userId = p.userId,
      rank = rankRead(doc),
      rating = p.rating,
      ratingDiff = p.ratingDiff,
      provisional = p.provisional,
      blurs = ~doc.getAsOpt[Blurs](blursBits),
      berserk = p.berserk,
      blindfold = ~doc.getAsOpt[Boolean](blindfold),
      name = doc.getAsOpt[PlayerName](name)
    )

  def playerWrite(p: Player) =
    import BSONFields.*
    $doc(
      aiLevel -> p.aiLevel,
      isOfferingDraw -> p.isOfferingDraw.option(true),
      proposeTakebackAt -> p.proposeTakebackAt.some.filter(_ > 0),
      rank -> p.rank.map(rankWrite),
      rating -> p.rating,
      ratingDiff -> p.ratingDiff,
      provisional -> p.provisional.yes.option(true),
      blursBits -> p.blurs.nonEmpty.so(p.blurs),
      blindfold -> p.blindfold,
      name -> p.name
    )

  private[game] def rankRead(doc: Bdoc): Option[RankSnapshot] =
    for
      rank <- doc.getAsOpt[Bdoc](BSONFields.rank)
      trackValue <- rank.getAsOpt[String]("t")
      track <- RankTrackId.from(trackValue)
      score <- rank.getAsOpt[Int]("s")
      code <- rank.getAsOpt[String]("c")
      ordinal <- rank.getAsOpt[Int]("o")
      catalogVersion <- rank.getAsOpt[Int]("cv")
    yield RankSnapshot(
      track = track,
      score = RankScore(score),
      code = RankCode(code),
      ordinal = ordinal,
      catalogVersion = catalogVersion,
      policyVersion = rank.getAsOpt[Int]("pv").getOrElse(lila.rating.XiangqiRank.firstPolicyVersion),
      established = rank.booleanLike("e").getOrElse(false),
      diff = rank.getAsOpt[Int]("d").map(RankDiff.apply),
      after = rank.getAsOpt[String]("a").map(RankCode.apply)
    )

  private[game] def rankWrite(rank: RankSnapshot): Bdoc =
    $doc(
      "t" -> rank.track.value,
      "s" -> rank.score.value,
      "c" -> rank.code.value,
      "o" -> rank.ordinal,
      "cv" -> rank.catalogVersion,
      "pv" -> rank.policyVersion,
      "e" -> rank.established.option(true),
      "d" -> rank.diff.map(_.value),
      "a" -> rank.after.map(_.value)
    )
