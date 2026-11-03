package lila.tv

import lila.common.Bus
import lila.threeKingdoms.{ KingdomGame, MatchUpdated }

/** Three-seat games cannot be represented by a two-color Pov. Selection still belongs to TV. One shared
  * selector and event stream serve every spectator; clients do not poll MongoDB.
  */
final class ThreeKingdomsTv(
    repo: lila.threeKingdoms.GameRepo,
    streams: lila.threeKingdoms.GameStreams,
    historyRepo: TvHistory
)(using Executor, Scheduler):
  import ThreeKingdomsTv.strength

  private val channel = "tv:threeKingdoms"
  private var candidates = Map.empty[GameId, KingdomGame]
  private var selected: Option[KingdomGame] = None
  private var previous = List.empty[GameId]
  private var loading = false
  private var historyWrite: Funit = historyRepo
    .load(Tv.Channel.ThreeKingdoms)
    .flatMap: ids =>
      repo
        .byIds(ids)
        .map: games =>
          synchronized:
            previous = (previous ++ games.map(_.id)).distinct.take(9)
            if selected.isEmpty then
              selected = games.headOption
              selected.foreach(streams.publishChannel(channel, _))

  def game: Option[KingdomGame] = synchronized(selected)
  def live: List[KingdomGame] = synchronized(
    candidates.values.filter(eligible).toList.sortBy(g => -strength(g)).take(20)
  )
  def history: Fu[List[KingdomGame]] =
    val ids = synchronized(previous.filterNot(id => selected.exists(_.id == id)).take(8))
    repo.byIds(ids)
  def source = streams.channel(channel, fuccess(game))

  private def eligible(g: KingdomGame) =
    !g.position.finished && g.movedAt.isAfter(nowInstant.minusSeconds(180))

  private def isCurrent(g: KingdomGame) =
    candidates.get(g.id).forall(_.revision <= g.revision) &&
      selected.filter(_.id == g.id).forall(_.revision <= g.revision)

  private def update(g: KingdomGame): Unit = synchronized:
    if isCurrent(g) then
      candidates = candidates.updated(g.id, g)
      reselect(Some(g))

  private def reselect(updated: Option[KingdomGame]): Unit =
    candidates = candidates.filter((_, value) => eligible(value))
    val next = ThreeKingdomsTv.choose(selected, candidates.values.toList, updated)
    val changed = selected.map(_.id) != next.map(_.id)
    selected = next
    if changed then
      selected
        .map(_.id)
        .foreach: id =>
          previous = TvHistory.prepend(id, previous)
          historyWrite = historyWrite
            .recover { case e => logger.error("TV history load/save failed", e) }
            .flatMap: _ =>
              val ids = synchronized(previous)
              historyRepo.record(Tv.Channel.ThreeKingdoms, ids)
    if changed || updated.exists(g => selected.exists(_.id == g.id)) then
      next.foreach(streams.publishChannel(channel, _))

  Bus.sub[MatchUpdated](event => update(event.game))
  summon[Scheduler].scheduleWithFixedDelay(2.seconds, 15.seconds): () =>
    synchronized:
      if !loading then
        loading = true
        repo.live.onComplete: result =>
          synchronized:
            result.foreach: games =>
              games.foreach: g =>
                if isCurrent(g) then candidates = candidates.updated(g.id, g)
              reselect(None)
            loading = false

private[tv] object ThreeKingdomsTv:
  private def strength(g: KingdomGame) = g.seats.flatMap(_.rank).map(_.ordinal).sum + 3

  // Live candidates take priority, but a quiet channel keeps its last broadcast.
  def choose(
      selected: Option[KingdomGame],
      candidates: List[KingdomGame],
      updated: Option[KingdomGame]
  ): Option[KingdomGame] =
    val current = selected.flatMap(g => candidates.find(_.id == g.id))
    val best = candidates.sortBy(value => (-strength(value), value.createdAt.toEpochMilli)).headOption
    val retained =
      selected.map(g => updated.filter(u => u.id == g.id && u.revision >= g.revision).getOrElse(g))
    current
      .filter(c => best.forall(b => strength(b) * 100 <= strength(c) * 118))
      .orElse(best)
      .orElse(retained)
