package lila.recap

import reactivemongo.api.bson.Macros.Annotations.Key
import lila.recap.Recap.Counted
import lila.core.game.Source
import play.api.libs.json.JsObject

case class Recap(
    @Key("_id") id: UserId,
    v: Int,
    year: Int,
    games: RecapGames,
    puzzles: RecapPuzzles,
    createdAt: Instant
):
  def userIds = games.opponents.map(_.value)

case class RecapGames(
    nbs: NbWin,
    nbRed: Int,
    moves: Int,
    firstRedMoves: List[Counted[String]],
    timePlaying: FiniteDuration,
    sources: Map[Source, Int],
    opponents: List[Counted[UserId]],
    perfs: List[Recap.Perf]
)

case class RecapPuzzles(nbs: NbWin = NbWin(), votes: PuzzleVotes = PuzzleVotes())

object Recap:

  val schemaVersion = 1

  case class Counted[A](value: A, count: Int)
  case class Perf(key: PerfKey, games: Int)

  type QueueEntry = ParallelQueue.Entry[UserId]

  enum Availability:
    case Available(data: JsObject)
    case Queued(data: JsObject)

case class NbWin(total: Int = 0, win: Int = 0)
case class PuzzleVotes(nb: Int = 0, themes: Int = 0)
