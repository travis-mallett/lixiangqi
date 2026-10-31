package lila.tv

private[tv] object ChannelSelection:
  /** Only eligible, fresh, fair-play-checked candidates may become the next broadcast. */
  def choose(
      candidates: List[Game],
      currentId: Option[GameId],
      rematchId: Option[GameId],
      score: Game => Int
  ): Option[Game] =
    val best = candidates.maximumByOption(score)
    candidates.find(g => currentId.contains(g.id)) match
      case Some(current) if !current.finished =>
        best.filter(g => g.id != current.id && score(g) > score(current) * 1.17)
      case _ => candidates.find(g => rematchId.contains(g.id)).orElse(best)
