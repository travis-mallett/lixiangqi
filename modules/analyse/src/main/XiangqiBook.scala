package lila.analyse

import play.api.libs.json.*
import play.api.libs.ws.StandaloneWSClient
import lila.memo.CacheApi
import lila.xiangqi.{ Xiangqi, XiangqiEvaluation, XiangqiRules }
import lila.xiangqi.XiangqiJson.given
import lila.xiangqi.adjudication.Ruleset

/** The CDB format boundary. Provider scores describe AXF analysis; native history owns legal moves/outcomes.
  */
final class XiangqiBook(ws: StandaloneWSClient, cacheApi: CacheApi)(using Executor):
  import XiangqiBook.*
  private val cache = cacheApi[(String, String), Either[String, Vector[Entry]]](1024, "xiangqi.book"):
    _.maximumSize(1024)
      .expireAfterWrite(15.minutes)
      .buildAsyncFuture: (fen, metric) =>
        ws.url("https://www.chessdb.cn/chessdb.php")
          .withRequestTimeout(8.seconds)
          .withFollowRedirects(false)
          .withQueryStringParameters(
            "action" -> "queryall",
            "board" -> fen,
            "egtbmetric" -> metric,
            "learn" -> "0"
          )
          .get()
          .map: response =>
            if response.status != 200 then Left(s"Xiangqi database returned HTTP ${response.status}")
            else parse(response.body)
          .recover { case _: Exception => Left("The Xiangqi database is unavailable") }

  def apply(request: Request): Fu[Either[String, Result]] =
    if !Set("dtm", "dtc")(request.metric) then fuccess(Left("Unsupported endgame metric"))
    else
      XiangqiEvaluation.game(Xiangqi.Position(request.initialFen, request.moves, request.ruleset)) match
        case Left(error) => fuccess(Left(error))
        case Right(game) if game.state.ended =>
          fuccess(Right(Result(sourceUrl, "AXF", request.metric, false, Vector.empty, game.state.gameResult)))
        case Right(game) =>
          cache
            .get((game.state.fen.split(' ').take(2).mkString(" "), request.metric))
            .map:
              _.flatMap: entries =>
                entries
                  .filter(e =>
                    game.state.legalMoves.contains(e.move) && (!request.endgame || e.outcome.isDefined)
                  )
                  .foldLeft[Either[String, Vector[Move]]](Right(Vector.empty)): (acc, entry) =>
                    for
                      previous <- acc
                      move <- XiangqiRules.move(game, entry.move)
                    yield previous :+ Move(
                      entry.move,
                      move.notation,
                      move.chineseNotation,
                      entry.score,
                      entry.rank,
                      entry.winrate,
                      entry.note,
                      entry.outcome,
                      entry.distance.filter(_ => request.metric == "dtm"),
                      entry.distance.filter(_ => request.metric == "dtc"),
                      entry.loops
                    )
                  .map(moves =>
                    Result(
                      sourceUrl,
                      "AXF",
                      request.metric,
                      moves.nonEmpty && moves.forall(_.outcome.isDefined),
                      moves,
                      game.state.gameResult
                    )
                  )

object XiangqiBook:
  val sourceUrl = "https://www.chessdb.cn/cloudbook_info_en.html"
  case class Request(
      initialFen: String,
      moves: Vector[Xiangqi.Uci],
      ruleset: Ruleset,
      metric: String,
      endgame: Boolean
  )
  case class Move(
      move: Xiangqi.Uci,
      notation: String,
      chineseNotation: String,
      score: Option[Int],
      rank: Option[Int],
      winrate: Option[Double],
      note: String,
      outcome: Option[String],
      dtm: Option[Int],
      dtc: Option[Int],
      loops: Option[Int]
  )
  case class Result(
      sourceUrl: String,
      providerRules: String,
      metric: String,
      tablebase: Boolean,
      moves: Vector[Move],
      gameResult: Xiangqi.Result
  )
  given Reads[Request] = Json.reads
  given OWrites[Move] = Json.writes
  given OWrites[Result] = Json.writes

  private[analyse] case class Entry(
      move: Xiangqi.Uci,
      score: Option[Int],
      rank: Option[Int],
      winrate: Option[Double],
      note: String,
      outcome: Option[String],
      distance: Option[Int],
      loops: Option[Int]
  )
  private val engineMove = "^([a-i])([0-9])([a-i])([0-9])$".r
  private val endgameNote = "\\(([WDL])-([M0-9]+)-([0-9]+)\\)".r

  private[analyse] def parse(text: String): Either[String, Vector[Entry]] =
    if text.length > 100_000 then Left("Xiangqi database response exceeds the size limit")
    else if Set("unknown", "nobestmove", "checkmate", "stalemate")(text.trim) then Right(Vector.empty)
    else if text.trim == "invalid board" then Left("The Xiangqi database rejected this position")
    else
      scala.util
        .Try:
          val entries = text.trim
            .split('|')
            .toVector
            .filter(_.nonEmpty)
            .map: row =>
              val fields = row
                .split(',')
                .map: field =>
                  val pair = field.split(":", 2)
                  require(pair.length == 2, "Invalid Xiangqi database field")
                  pair(0).trim -> pair(1).trim
                .toMap
              val move = fields.getOrElse("move", "") match
                case engineMove(fromFile, fromRank, toFile, toRank) =>
                  Xiangqi.Uci.unsafe(s"$fromFile${fromRank.toInt + 1}$toFile${toRank.toInt + 1}")
                case _ => throw IllegalArgumentException("Invalid Xiangqi database move")
              def number(name: String) = fields
                .get(name)
                .filterNot(_ == "??")
                .map: value =>
                  value.toIntOption.getOrElse(throw IllegalArgumentException(s"Invalid database $name"))
              val note = fields.getOrElse("note", "")
              val ending = endgameNote.findFirstMatchIn(note)
              val winrate = fields
                .get("winrate")
                .filterNot(_ == "??")
                .map: value =>
                  val rate = value.toDouble
                  require(rate.isFinite && rate >= 0 && rate <= 100, "Invalid database win rate")
                  rate
              Entry(
                move,
                number("score"),
                number("rank"),
                winrate,
                note,
                ending.map(m => Map("W" -> "win", "D" -> "draw", "L" -> "loss")(m.group(1))),
                ending.map(_.group(3).toInt),
                ending.flatMap(_.group(2).toIntOption)
              )
          require(
            entries.size <= 128 && entries.map(_.move).distinct.size == entries.size,
            "Invalid database move count"
          )
          entries
        .toEither
        .left
        .map(_.getMessage)
