package lila.tv

import chess.Color
import scalalib.actor.SyncActor
import scalalib.HeapSort.topNToList

import lila.core.LightUser
import lila.core.rank.RankScore.*
import lila.rating.XiangqiRank

final private class ChannelSyncActor(
    channel: Tv.Channel,
    onSelect: TvSyncActor.Selected => Unit,
    gameProxy: lila.core.game.GameProxy,
    rematchOf: GameId => Option[GameId],
    lightUserSync: LightUser.GetterSync,
    userApi: lila.core.user.UserApi,
    historyRepo: TvHistory
)(using Executor)
    extends SyncActor:

  import ChannelSyncActor.*

  // games featured on this channel
  // first entry is the current game
  private var history = List.empty[GameId]
  private var initialized = false
  private var selecting = false

  private def oneId = history.headOption

  // The list of candidates by descending native Xiangqi rank score.
  private var manyIds = List.empty[GameId]

  private val candidateIds = scalalib.cache.ExpireSetMemo[GameId](channel.candidateLifetime)

  protected val process: SyncActor.Receive =

    case GetGameId(promise) => promise.success(oneId)

    case GetGameIdAndHistory(promise) => promise.success(GameIdAndHistory(oneId, history.drop(1)))

    case GetGameIds(max, promise) => promise.success(manyIds.take(max))

    case GetReplacementGameId(oldId, exclude, promise) =>
      promise.success {
        (rematchOf(oldId).filter(manyIds.contains) ++ manyIds)
          .find(id => id != oldId && !exclude.contains(id))
      }

    case Loaded(scala.util.Success((ids, game))) =>
      history = ids
      initialized = true
      selecting = false
      game.foreach(g => onSelect(TvSyncActor.Selected(channel, g)))
      this ! TvSyncActor.Select

    case Loaded(scala.util.Failure(error)) =>
      selecting = false
      logger.error(s"Cannot load ${channel.key} TV history", error)

    case Selection(scala.util.Success((one, many))) =>
      selecting = false
      manyIds = many
      one
        .filterNot(g => oneId.contains(g.id))
        .foreach: game =>
          history = TvHistory.prepend(game.id, history)
          onSelect(TvSyncActor.Selected(channel, game))
          lila.mon.tv.selector.rating(channel.name).record(averageRankScore(game))

    case Selection(scala.util.Failure(error)) =>
      selecting = false
      logger.error(s"Cannot select ${channel.key} TV game", error)

    case TvSyncActor.Select =>
      if !selecting then
        selecting = true
        if !initialized then
          historyRepo
            .load(channel)
            .flatMap { ids =>
              ids.headOption.so(gameProxy.game).map(ids -> _)
            }
            .onComplete(result => this ! Loaded(result))
        else
          lila.mon.tv.selector.candidates(channel.name).record(candidateIds.count)
          val current = oneId
          val previous = history
          doSelectNow(current)
            .flatMap { (one, many) =>
              val selected = one.filterNot(g => current.contains(g.id))
              selected
                .so(g => historyRepo.record(channel, TvHistory.prepend(g.id, previous)))
                .map(_ => selected -> many)
            }
            .onComplete(result => this ! Selection(result))

  def addCandidate(game: Game): Unit = candidateIds.put(game.id)

  private val rankOrdering = Ordering.by[Game, Int](averageRankScore)

  private def doSelectNow(currentId: Option[GameId]): Fu[(Option[Game], List[GameId])] = for
    allCandidates <- candidateIds.keys.parallel(gameProxy.gameIfPresent)
    freshCandidates = allCandidates.view.collect:
      case Some(g) if channel.isFresh(g) => g
    sortedCandidates = topNToList(freshCandidates, 64)(using rankOrdering)
    cheaters <- userApi.filterEngines(sortedCandidates.flatMap(_.userIds))
    candidates = sortedCandidates.filterNot(_.userIds.toSet.intersect(cheaters).nonEmpty)
    _ = lila.mon.tv.selector.cheats(channel.name).record(sortedCandidates.size - candidates.size)
    newBest = ChannelSelection.choose(candidates, currentId, currentId.flatMap(rematchOf), score)
  yield newBest -> candidates.map(_.id)

  private def score(game: Game): Int =
    heuristics.foldLeft(0): (score, fn) =>
      score + fn(game)

  private type Heuristic = Game => Int

  private val heuristics: List[Heuristic] = List(
    rankHeuristic(Color.White),
    rankHeuristic(Color.Black),
    titleHeuristic(Color.White),
    titleHeuristic(Color.Black)
  )

  private def rankHeuristic(color: Color): Heuristic =
    game => game.player(color).rank.fold(XiangqiRank.catalog.initialScore.value)(_.score.value)

  private def averageRankScore(game: Game): Int =
    val scores = game.players.flatMap(_.rank.map(_.score.value))
    if scores.isEmpty then XiangqiRank.catalog.initialScore.value else scores.sum / scores.size

  private def titleHeuristic(color: Color): Heuristic = game =>
    ~game
      .player(color)
      .some
      .flatMap: p =>
        p.rank.exists(_.score.value >= 2100).so(p.userId)
      .flatMap(lightUserSync)
      .flatMap(_.title)
      .flatMap(Tv.titleScores.get)

object ChannelSyncActor:

  case class GetGameId(promise: Promise[Option[GameId]])
  case class GetGameIds(max: Int, promise: Promise[List[GameId]])
  case class GetReplacementGameId(oldId: GameId, exclude: List[GameId], promise: Promise[Option[GameId]])
  private case class Loaded(result: scala.util.Try[(List[GameId], Option[Game])])
  private case class Selection(result: scala.util.Try[(Option[Game], List[GameId])])

  case class GetGameIdAndHistory(promise: Promise[GameIdAndHistory])
  case class GameIdAndHistory(gameId: Option[GameId], history: List[GameId])
