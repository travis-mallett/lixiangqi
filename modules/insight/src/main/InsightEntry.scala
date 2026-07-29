package lila.insight

import chess.IntRating
import chess.rating.IntRatingDiff

import lila.core.game.Source

case class InsightEntry(
    id: String, // gameId + w/b
    userId: UserId,
    color: Color,
    perf: PerfKey,
    rating: Option[IntRating], // stable rating only
    opponentRating: Option[IntRating], // stable rating only
    opponentStrength: Option[RelativeStrength],
    moves: List[InsightMove],
    result: Result,
    termination: Termination,
    ratingDiff: IntRatingDiff,
    analysed: Boolean,
    provisional: Boolean,
    source: Option[Source],
    date: Instant
)

case object InsightEntry:

  val schemaVersion = 1

  def povToId(pov: Pov) = s"${pov.gameId}${pov.color.letter}"

  object BSONFields:
    val id = "_id"
    val version = "v"
    val number = "n"
    val userId = "u"
    val color = "c"
    val perf = "p"
    val rating = "mr"
    val opponentRating = "or"
    val opponentStrength = "os"
    val moves: String = "m"
    def moves(f: String): String = s"$moves.$f"
    val result = "r"
    val termination = "t"
    val ratingDiff = "rd"
    val analysed = "a"
    val provisional = "pr"
    val source = "so"
    val date = "d"
