package lila.tv

import chess.PlayerTitle
import scalalib.actor.SyncActor

import lila.core.LightUser
import lila.core.rank.{ RankCode, RankTrackId }
import lila.core.rank.RankCode.*
import lila.ui.Icon

final class Tv(
    actor: SyncActor,
    gameProxy: lila.core.game.GameProxy
)(using Executor):

  import Tv.*
  import ChannelSyncActor.*

  def getGame(channel: Tv.Channel): Fu[Option[Game]] =
    actor
      .ask[Option[GameId]](TvSyncActor.GetGameId(channel, _))
      .flatMapz(gameProxy.game)

  def getReplacementGame(channel: Tv.Channel, oldId: GameId, exclude: List[GameId]): Fu[Option[Game]] =
    actor
      .ask[Option[GameId]](TvSyncActor.GetReplacementGameId(channel, oldId, exclude, _))
      .flatMapz(gameProxy.game)

  def getGameAndHistory(channel: Tv.Channel): Fu[Option[(Game, List[Pov])]] =
    actor
      .ask[GameIdAndHistory](TvSyncActor.GetGameIdAndHistory(channel, _))
      .flatMap:
        case GameIdAndHistory(gameId, historyIds) =>
          for
            game <- gameId.so(gameProxy.game)
            games <-
              historyIds
                .traverse: id =>
                  gameProxy.game(id)
                .dmap(_.flatten)
            history = games.map(Pov.naturalOrientation)
          yield game.map(_ -> history)

  def getGames(channel: Tv.Channel, max: Int): Fu[List[Game]] =
    getGameIds(channel, max).flatMap:
      _.map(gameProxy.game).parallel.map(_.flatten)

  def getRecentGames(channel: Tv.Channel): Fu[List[Game]] =
    actor
      .ask[GameIdAndHistory](TvSyncActor.GetGameIdAndHistory(channel, _))
      .flatMap: state =>
        (state.gameId.toList ::: state.history).distinct.traverse(gameProxy.game).map(_.flatten)

  def getGameIds(channel: Tv.Channel, max: Int): Fu[List[GameId]] =
    actor.ask[List[GameId]](TvSyncActor.GetGameIds(channel, max, _))

  def getBestGame = getGame(Tv.Channel.Best)

  def getBestAndHistory = getGameAndHistory(Tv.Channel.Best)

  def getChampions: Fu[Champions] =
    actor.ask[Champions](TvSyncActor.GetChampions.apply)

object Tv:

  case class Champion(user: LightUser, rank: Option[RankCode], gameId: GameId, color: Color)
  case class Champions(channels: Map[Channel, Champion]):
    export channels.get

  import play.api.libs.json.*
  import lila.common.Json.given
  given Writes[lila.tv.Tv.Champion] = Writes: champion =>
    Json.obj(
      "user" -> champion.user,
      "rank" -> champion.rank.map(_.value),
      "gameId" -> champion.gameId,
      "color" -> champion.color
    )

  private[tv] case class Candidate(game: Game, hasBot: Boolean)

  enum Channel(
      val name: String,
      val icon: Icon,
      val secondsSinceLastMove: Int,
      filters: Seq[Candidate => Boolean],
      val listed: Boolean = true,
      val variant: Option[lila.xiangqi.GameVariant] = None
  ):
    // Refreshed on every move; inactive games need not occupy the selector for an entire game duration.
    val candidateLifetime: FiniteDuration = (secondsSinceLastMove + 10).seconds
    def isFresh(g: Game): Boolean = fresh(secondsSinceLastMove, g)
    def filter(c: Candidate): Boolean =
      (c.game.hasClock || c.game.hasAi || (variant.isDefined && c.game.isUnlimited)) &&
        variant.forall(_ == c.game.nativeVariant) && filters.forall { _(c) } && isFresh(c.game)
    val key = variant.fold(lila.common.String.lcfirst(toString))(_.key)
    case Xiangqi
        extends Channel(
          name = "Xiangqi",
          icon = lila.ui.VariantIcon(lila.xiangqi.GameVariant.Xiangqi),
          secondsSinceLastMove = 180,
          filters = Nil,
          variant = Some(lila.xiangqi.GameVariant.Xiangqi)
        )
    case Jieqi
        extends Channel(
          name = "Jieqi",
          icon = lila.ui.VariantIcon(lila.xiangqi.GameVariant.Jieqi),
          secondsSinceLastMove = 180,
          filters = Nil,
          variant = Some(lila.xiangqi.GameVariant.Jieqi)
        )
    case MiniXiangqi
        extends Channel(
          name = "Mini Xiangqi",
          icon = lila.ui.VariantIcon(lila.xiangqi.GameVariant.MiniXiangqi),
          secondsSinceLastMove = 180,
          filters = Nil,
          variant = Some(lila.xiangqi.GameVariant.MiniXiangqi)
        )
    case Manchu
        extends Channel(
          name = "Manchu+",
          icon = lila.ui.VariantIcon(lila.xiangqi.GameVariant.Manchu),
          secondsSinceLastMove = 180,
          filters = Nil,
          variant = Some(lila.xiangqi.GameVariant.Manchu)
        )
    case ThreeKingdoms
        extends Channel(
          name = "Game of the Three Kingdoms",
          icon = lila.ui.VariantIcon(lila.xiangqi.GameVariant.ThreeKingdoms),
          secondsSinceLastMove = 180,
          filters = Nil,
          variant = Some(lila.xiangqi.GameVariant.ThreeKingdoms)
        )
    case Best
        extends Channel(
          name = "Ranked Xiangqi",
          icon = lila.ui.VariantIcon(lila.xiangqi.GameVariant.Xiangqi),
          secondsSinceLastMove = 60 * 3,
          filters = Seq(rankedXiangqi, standard, noBot)
        )
    case Bot
        extends Channel(
          name = "Bot",
          icon = Icon.Cogs,
          secondsSinceLastMove = 60 * 2,
          filters = Seq(standard, hasBot)
        )
    case Computer
        extends Channel(
          name = "Computer",
          icon = Icon.Cogs,
          secondsSinceLastMove = 60 * 2,
          filters = Seq(computerFromInitialPosition)
        )

  object Channel:
    val list = values.filter(_.listed).toList
    val byKey = list.mapBy(_.key)

  private val rankedXiangqi = (c: Candidate) => c.game.rankTrack.contains(RankTrackId.xiangqi)
  private val standard = (c: Candidate) => c.game.nativeVariant == lila.xiangqi.GameVariant.Xiangqi
  private def computerFromInitialPosition(c: Candidate) = c.game.hasAi && !c.game.fromPosition
  private def hasBot(c: Candidate) = c.hasBot
  private def noBot(c: Candidate) = !c.hasBot
  private def olderThan(g: Game, seconds: Int) = g.movedAt.isBefore(nowInstant.minusSeconds(seconds))
  private def fresh(seconds: Int, game: Game): Boolean =
    (game.started && game.isBeingPlayed && !olderThan(game, seconds)) ||
      (game.finished && !olderThan(game, 7)) // rematch time

  private[tv] val titleScores: Map[PlayerTitle, Int] = Map(
    PlayerTitle.GM -> 600,
    PlayerTitle.WGM -> 600,
    PlayerTitle.IM -> 400,
    PlayerTitle.WIM -> 400,
    PlayerTitle.FM -> 250,
    PlayerTitle.WFM -> 250,
    PlayerTitle.NM -> 150,
    PlayerTitle.CM -> 150,
    PlayerTitle.WCM -> 150,
    PlayerTitle.WNM -> 150
  )
