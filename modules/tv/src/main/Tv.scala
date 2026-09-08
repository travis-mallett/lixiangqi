package lila.tv

import chess.PlayerTitle
import scalalib.actor.SyncActor

import lila.core.LightUser
import lila.core.rank.{ RankCode, RankTrackId }
import lila.core.rank.RankCode.*
import lila.game.GameRepo
import lila.ui.Icon

final class Tv(
    gameRepo: GameRepo,
    actor: SyncActor,
    gameProxy: lila.core.game.GameProxy
)(using Executor):

  import Tv.*
  import ChannelSyncActor.*

  def getGame(channel: Tv.Channel): Fu[Option[Game]] =
    actor
      .ask[Option[GameId]](TvSyncActor.GetGameId(channel, _))
      .flatMapz(gameProxy.game)
      .orElse(gameRepo.latestStandard)

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
            game <- gameId.so(gameProxy.game).orElse(gameRepo.latestStandard)
            games <-
              historyIds
                .traverse: id =>
                  gameProxy.game(id).orElse(gameRepo.game(id))
                .dmap(_.flatten)
            history = games.map(Pov.naturalOrientation)
          yield game.map(_ -> history)

  def getGames(channel: Tv.Channel, max: Int): Fu[List[Game]] =
    getGameIds(channel, max).flatMap:
      _.map(gameProxy.game).parallel.map(_.flatten)

  def getGameIds(channel: Tv.Channel, max: Int): Fu[List[GameId]] =
    actor.ask[List[GameId]](TvSyncActor.GetGameIds(channel, max, _))

  def getBestGame = getGame(Tv.Channel.Best)

  def getBestAndHistory = getGameAndHistory(Tv.Channel.Best)

  def getChampions: Fu[Champions] =
    actor.ask[Champions](TvSyncActor.GetChampions.apply)

object Tv:
  import chess.variant as V

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
      val candidateLifetime: FiniteDuration = 3.minutes
  ):
    def isFresh(g: Game): Boolean = fresh(secondsSinceLastMove, g)
    def filter(c: Candidate): Boolean = filters.forall { _(c) } && isFresh(c.game)
    val key = lila.common.String.lcfirst(toString)
    case Best
        extends Channel(
          name = "Ranked Xiangqi",
          icon = Icon.CrownElite,
          secondsSinceLastMove = 60 * 3,
          filters = Seq(rankedXiangqi, standard, noBot),
          candidateLifetime = 45.minutes
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
  private def variant(variant: chess.variant.Variant) = (c: Candidate) => c.game.variant == variant
  private val standard = variant(V.Standard)
  private def computerFromInitialPosition(c: Candidate) = c.game.hasAi && !c.game.fromPosition
  private def hasBot(c: Candidate) = c.hasBot
  private def noBot(c: Candidate) = !c.hasBot
  private def olderThan(g: Game, seconds: Int) = g.movedAt.isBefore(nowInstant.minusSeconds(seconds))
  private def fresh(seconds: Int, game: Game): Boolean =
    (game.isBeingPlayed && !olderThan(game, seconds)) ||
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
