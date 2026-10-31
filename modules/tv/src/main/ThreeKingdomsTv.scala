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
  private val channel = "tv:threeKingdoms"
  private var candidates = Map.empty[GameId, KingdomGame]
  private var selected: Option[GameId] = None
  private var previous = List.empty[GameId]
  private var loading = false
  private var historyWrite: Funit = historyRepo
    .load(Tv.Channel.ThreeKingdoms)
    .map: ids =>
      synchronized { previous = (previous ++ ids).distinct.take(9) }

  def game: Option[KingdomGame] = synchronized(selected.flatMap(candidates.get).filter(eligible))
  def live: List[KingdomGame] = synchronized(
    candidates.values.filter(eligible).toList.sortBy(g => -strength(g)).take(20)
  )
  def history: Fu[List[KingdomGame]] =
    val ids = synchronized(previous.filterNot(selected.contains).take(8))
    repo.byIds(ids)
  def source = streams.channel(channel, fuccess(game))

  private def eligible(g: KingdomGame) =
    !g.position.finished && g.movedAt.isAfter(nowInstant.minusSeconds(180))
  private def strength(g: KingdomGame) = g.seats.flatMap(_.rank).map(_.ordinal).sum + 3

  private def update(g: KingdomGame): Unit = synchronized:
    if candidates.get(g.id).forall(_.revision <= g.revision) then
      candidates = candidates.updated(g.id, g)
      reselect(Some(g))

  private def reselect(updated: Option[KingdomGame]): Unit =
    val former = selected
    candidates = candidates.filter((_, value) => eligible(value))
    val current = selected.flatMap(candidates.get)
    val best =
      candidates.values.toList.sortBy(value => (-strength(value), value.createdAt.toEpochMilli)).headOption
    val next = current.filter(c => best.forall(b => strength(b) * 100 <= strength(c) * 118)).orElse(best)
    val changed = selected != next.map(_.id)
    if changed then
      selected = next.map(_.id)
      selected.foreach: id =>
        previous = TvHistory.prepend(id, previous)
        historyWrite = historyWrite
          .recover { case e => logger.error("TV history load/save failed", e) }
          .flatMap: _ =>
            val ids = synchronized(previous)
            historyRepo.record(Tv.Channel.ThreeKingdoms, ids)
    if changed || updated.exists(g => selected.contains(g.id)) then
      next.foreach(streams.publishChannel(channel, _))
    // Emit the final state before a quiet channel empties, so spectators see the result.
    if next.isEmpty then
      updated
        .filter(g => former.contains(g.id) && g.position.finished)
        .foreach(streams.publishChannel(channel, _))

  Bus.sub[MatchUpdated](event => update(event.game))
  summon[Scheduler].scheduleWithFixedDelay(2.seconds, 15.seconds): () =>
    synchronized:
      if !loading then
        loading = true
        repo.live.onComplete: result =>
          synchronized:
            result.foreach: games =>
              games.foreach: g =>
                if candidates.get(g.id).forall(_.revision <= g.revision) then
                  candidates = candidates.updated(g.id, g)
              reselect(None)
            loading = false
