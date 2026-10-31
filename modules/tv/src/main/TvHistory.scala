package lila.tv

import lila.db.dsl.{ *, given }

/** One bounded document per channel. Only actual selections belong here, never page-view fallbacks. */
private[tv] final class TvHistory(coll: Coll)(using Executor):
  def load(channel: Tv.Channel): Fu[List[GameId]] =
    coll.primitiveOne[List[GameId]]($id(channel.key), "games").map(_.getOrElse(Nil).distinct)

  def record(channel: Tv.Channel, history: List[GameId]): Funit =
    coll.update
      .one(
        $id(channel.key),
        $set("games" -> history),
        upsert = true
      )
      .void

private[tv] object TvHistory:
  def prepend(id: GameId, history: List[GameId]): List[GameId] =
    (id :: history.filterNot(_ == id)).take(9)
