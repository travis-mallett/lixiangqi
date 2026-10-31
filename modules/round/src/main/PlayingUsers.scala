package lila.round

import lila.common.Bus

final class PlayingUsers(using Executor):

  private val playing = com.github.blemale.scaffeine
    .Scaffeine()
    .expireAfterWrite(3.hours)
    .build[UserId, Set[GameId]]()

  def apply(userId: UserId): Boolean = playing.getIfPresent(userId).exists(_.nonEmpty)

  def update(gameId: GameId, participants: List[UserId], active: Set[UserId]): Unit =
    participants.foreach: user =>
      playing.underlying.asMap.compute(
        user,
        (_, current) =>
          val others = Option(current).getOrElse(Set.empty) - gameId
          val next = if active.contains(user) then others + gameId else others
          Option.when(next.nonEmpty)(next).orNull
      )

  Bus.sub[lila.core.game.FinishGame]:
    case lila.core.game.FinishGame(game, _) if game.hasClock =>
      update(game.id, game.userIds, Set.empty)
  Bus.sub[lila.core.game.StartGame]:
    case lila.core.game.StartGame(game, _) if game.hasClock =>
      update(game.id, game.userIds, game.userIds.toSet)
