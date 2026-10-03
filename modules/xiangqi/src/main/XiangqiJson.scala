package lila.xiangqi

import play.api.libs.json.*

import Xiangqi.*
import lila.xiangqi.adjudication.{ Ruleset, MoveFact, AdjudicationState }

object XiangqiJson:

  given [A: Reads]: Reads[BySide[A]] = Reads: json =>
    for
      red <- (json \ "red").validate[A]
      black <- (json \ "black").validate[A]
    yield BySide(red, black)

  given [A: Writes]: OWrites[BySide[A]] =
    OWrites(value => Json.obj("red" -> value.red, "black" -> value.black))

  given Reads[Uci] = Reads.StringReads.flatMapResult: value =>
    Uci.from(value) match
      case Left(error) => JsError(error)
      case Right(uci) => JsSuccess[Uci](uci)

  given Writes[Uci] = Writes.StringWrites.contramap(_.value)

  given Format[Square] = Format(
    Reads.StringReads.flatMapResult(value =>
      Square.fromKey(value).fold[JsResult[Square]](JsError(s"Invalid Xiangqi square: $value"))(JsSuccess(_))
    ),
    Writes.StringWrites.contramap(_.key)
  )

  given Format[UciPath] = Format(
    Reads.StringReads.flatMapResult(value => UciPath.from(value).fold(JsError(_), JsSuccess(_))),
    Writes.StringWrites.contramap(_.value)
  )

  given OFormat[Move] = Json.format

  given Format[Side] = Format(
    Reads.StringReads.flatMapResult(value => Side.fromKey(value).fold(JsError(_), JsSuccess(_))),
    Writes.StringWrites.contramap(_.key)
  )

  given Format[Result] = Format(
    Reads.StringReads.flatMapResult(value => Result.fromKey(value).fold(JsError(_), JsSuccess(_))),
    Writes.StringWrites.contramap(_.key)
  )

  given Format[Ruleset] = Format(
    Reads.StringReads.flatMapResult(value => Ruleset.fromKey(value).fold(JsError(_), JsSuccess(_))),
    Writes.StringWrites.contramap(_.key)
  )
  given Format[RecordedResult] = Format(
    Reads.StringReads.flatMapResult(value => RecordedResult.fromKey(value).fold(JsError(_), JsSuccess(_))),
    Writes.StringWrites.contramap(_.key)
  )
  given OFormat[MoveFact] = Json.format
  given OFormat[AdjudicationState] = Json.format
  given OFormat[Position] = Json.using[Json.WithDefaultValues].format
  given OFormat[ExplorerQuery] = Json.format
  given OFormat[GamesQuery] = Json.format
  given OFormat[CatalogGameQuery] = Json.format
  given OFormat[PuzzleQuery] = Json.format
  given OFormat[MoveCommand] = Json.using[Json.WithDefaultValues].format
  given OFormat[VariationCommand] = Json.using[Json.WithDefaultValues].format
  given OFormat[NotationMoveCommand] = Json.using[Json.WithDefaultValues].format
  given OFormat[AnalysisCommand] = Json.format
  given OFormat[NotationImport] = Json.format
  given OFormat[Ending] = Json.format
  given OFormat[State] = Json.format
  given OFormat[VariationMove] = Json.format
  given OFormat[VariationResult] = Json.format
  given OFormat[XiangqiMotifs.Pin] = Json.format
  given OFormat[XiangqiMotifs.Undefended] = Json.format
  given OFormat[XiangqiMotifs.Checkable] = Json.format
  given OFormat[XiangqiMotifs.Motifs] = Json.format
  given OFormat[MoveResult] = Json.format
  given OFormat[LessonValidation] = Json.format
  given OFormat[EngineScore] = Json.format
  given OFormat[EngineLine] = Json.format
  given OFormat[EngineAnalysis] = Json.format
  given OFormat[ExplorerMove] = Json.format
  given OFormat[ExplorerResult] = Json.format
  given Format[XiangqiAnnotations.Shape] = Format(
    Reads: json =>
      for
        brush <- (json \ "brush")
          .validate[String]
          .filter(JsError("Invalid annotation brush"))(
            Set("green", "red", "blue", "yellow")
          )
        orig <- (json \ "orig").validate[Square]
        dest <- (json \ "dest").validateOpt[Square]
      yield dest.fold[XiangqiAnnotations.Shape](XiangqiAnnotations.Shape.Circle(brush, orig))(
        XiangqiAnnotations.Shape.Arrow(brush, orig, _)
      ),
    Writes:
      case XiangqiAnnotations.Shape.Circle(brush, orig) => Json.obj("brush" -> brush, "orig" -> orig)
      case XiangqiAnnotations.Shape.Arrow(brush, orig, dest) =>
        Json.obj("brush" -> brush, "orig" -> orig, "dest" -> dest)
  )
  given OFormat[XiangqiAnnotations.Evaluation] = OFormat(
    Reads: json =>
      for
        cp <- (json \ "cp").validateOpt[Int]
        mate <- (json \ "mate").validateOpt[Int]
        depth <- (json \ "depth").validateOpt[Int]
        result <-
          if cp.isDefined == mate.isDefined then JsError("An evaluation requires exactly one score")
          else if depth.exists(_ <= 0) then JsError("Evaluation depth must be positive")
          else JsSuccess(XiangqiAnnotations.Evaluation(cp, mate, depth))
      yield result,
    Json.writes[XiangqiAnnotations.Evaluation]
  )
  given OFormat[XiangqiAnnotations.Parsed] = Json.using[Json.WithDefaultValues].format
  given OFormat[ImportedTreeNode] = Json.format
  given OFormat[ImportedMoveTree] = Json.format
