package lila.relay

import play.api.libs.json.*
import scalalib.model.Seconds
import chess.format.pgn.{ PgnStr, Tag, Tags }
import lila.xiangqi.Xiangqi.{ BySide, Side }
import lila.xiangqi.{ XiangqiAnnotations, XiangqiRules }

private object DgtJson:

  case class PairingPlayer(
      fname: Option[String],
      mname: Option[String],
      lname: Option[String],
      title: Option[String],
      fideid: Option[Int]
  ):
    def fullName = some {
      List(fname, mname, lname).flatten.mkString(" ")
    }.filter(_.nonEmpty)

  case class RoundJsonPairing(
      live: Boolean,
      white: Option[PairingPlayer],
      black: Option[PairingPlayer],
      result: Option[String]
  ):
    def tags(round: Int, game: Int, date: Option[String]) = Tags:
      List(
        white.flatMap(_.fullName).map { Tag("Red", _) },
        white.flatMap(_.title).map { Tag("RedTitle", _) },
        white.flatMap(_.fideid).map { value => Tag("RedFideId", value.toString) },
        black.flatMap(_.fullName).map { Tag(_.Black, _) },
        black.flatMap(_.title).map { Tag(_.BlackTitle, _) },
        black.flatMap(_.fideid).map { Tag(_.BlackFideId, _) },
        result.map(Tag(_.Result, _)),
        Tag(_.Round, s"$round.$game").some,
        date.map(Tag(_.Date, _))
      ).flatten
    def nonEmpty = white.isDefined && black.isDefined

  case class RoundJson(
      date: Option[String],
      pairings: List[RoundJsonPairing]
  ):
    def formattedDate = date.map(_.replace("-", "."))
    def firstNonEmptyPairingIndex: Option[Int] =
      pairings.indexWhere(_.nonEmpty).some.filter(_ >= 0)

  case class ClockJson(white: Option[Seconds], black: Option[Seconds], time: Long):
    def referenceTime: Instant = millisToInstant(time)
    def bySide = BySide(white, black)

  /** DGT's external white/black fields map to Red/Black once at this format boundary. A separately reported
    * clock takes precedence over the latest move clock.
    */
  case class GameJson(
      moves: List[String],
      result: Option[String],
      clock: Option[ClockJson] = none,
      fen: Option[String] = none
  ):
    def mergeRoundTags(roundTags: Tags): Tags =
      roundTags ++ Tags(List(fen.map(Tag(_.FEN, _)), result.map(Tag(_.Result, _))).flatten)
    def clockTags: Tags =
      clock.fold(Tags.empty): c =>
        Tags(
          List(
            c.white.map(v => Tag("RedClock", showClock(v))),
            c.black.map(v => Tag("BlackClock", showClock(v)))
            // Tag(_.ReferenceTime, c.referenceTime.toString).some // unused
          ).flatten
        )
    def toPgn(roundTags: Tags): PgnStr =
      val mergedTags = clockTags ++ mergeRoundTags(roundTags)
      val parsedMoves = moves.map(parseMove)
      val turn =
        XiangqiRules.initialGame(fen).fold(error => throw IllegalArgumentException(error), _.state.turn)
      val fixedMoves =
        clock.foldLeft(parsedMoves)((moves, clock) => replaceLastMoveTimesWithClock(moves, clock, turn))
      val strMoves = fixedMoves.map(_.render).mkString(" ")
      PgnStr(s"$mergedTags\n\n$strMoves")

  private case class ExternalMove(notation: String, clock: Option[Int], elapsed: Option[Int]):
    def render =
      val comments = XiangqiAnnotations.render(XiangqiAnnotations.Parsed(clock = clock, elapsed = elapsed))
      (notation :: comments.toList.map(text => s"{$text}")).mkString(" ")

  private def showClock(seconds: Seconds): String =
    XiangqiAnnotations
      .render(XiangqiAnnotations.Parsed(clock = Some(seconds.value * 100)))
      .head
      .stripPrefix("[%clk ")
      .stripSuffix("]")

  private def parseMove(str: String): ExternalMove =
    def time(raw: String) = raw.toIntOption
      .filter(_ >= 0)
      .filter(_ <= Int.MaxValue / 100)
      .map(_ * 100)
      .getOrElse(throw IllegalArgumentException(s"Invalid DGT clock: $str"))
    str.trim.split("\\s+").toList match
      case notation :: Nil if notation.nonEmpty => ExternalMove(notation, None, None)
      case notation :: clocks :: Nil =>
        clocks.split("\\+", -1).toList match
          case clock :: Nil => ExternalMove(notation, Some(time(clock)), None)
          case "" :: elapsed :: Nil => ExternalMove(notation, None, Some(time(elapsed)))
          case clock :: elapsed :: Nil => ExternalMove(notation, Some(time(clock)), Some(time(elapsed)))
          case _ => throw IllegalArgumentException(s"Invalid DGT move: $str")
      case _ => throw IllegalArgumentException(s"Invalid DGT move: $str")

  private def replaceLastMoveTimesWithClock(
      moves: List[ExternalMove],
      clock: ClockJson,
      first: Side
  ): List[ExternalMove] =
    val lastMoveIndex = moves.size - 1
    def change(move: ExternalMove, sec: Option[Seconds]) =
      sec.fold(move)(s => move.copy(clock = (s.value * 100).some))
    moves.mapWithIndex: (move, i) =>
      if i >= lastMoveIndex - 1
      then change(move, clock.bySide(if i % 2 == 0 then first else !first))
      else move

  given Reads[PairingPlayer] = Json.reads
  given Reads[RoundJsonPairing] = Json.reads
  given Reads[RoundJson] = Json.reads
  given Reads[Seconds] = Reads
    .of[Int]
    .filter(JsonValidationError("Invalid clock seconds"))(v => v >= 0 && v <= Int.MaxValue / 100)
    .map(Seconds.apply)
  given Reads[ClockJson] = Json.reads
  given Reads[GameJson] = Json.reads
