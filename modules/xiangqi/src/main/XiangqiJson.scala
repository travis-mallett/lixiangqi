package lila.xiangqi

import play.api.libs.json.*

import Xiangqi.*

object XiangqiJson:

  given Reads[Uci] = Reads.StringReads.flatMapResult: value =>
    Uci.from(value) match
      case Left(error) => JsError(error)
      case Right(uci) => JsSuccess[Uci](uci)

  given Writes[Uci] = Writes.StringWrites.contramap(_.value)

  given Format[Side] = Format(
    Reads.StringReads.flatMapResult(value => Side.fromKey(value).fold(JsError(_), JsSuccess(_))),
    Writes.StringWrites.contramap(_.key)
  )

  given Format[Result] = Format(
    Reads.StringReads.flatMapResult(value => Result.fromKey(value).fold(JsError(_), JsSuccess(_))),
    Writes.StringWrites.contramap(_.key)
  )

  given OFormat[Position] = Json.format
  given OFormat[ExplorerQuery] = Json.format
  given OFormat[GamesQuery] = Json.format
  given OFormat[CatalogGameQuery] = Json.format
  given OFormat[PuzzleQuery] = Json.format
  given OFormat[MoveCommand] = Json.format
  given OFormat[AnalysisCommand] = Json.format
  given OFormat[NotationImport] = Json.format
  given OFormat[Ending] = Json.format
  given OFormat[State] = Json.format
  given OFormat[MoveResult] = Json.format
  given OFormat[LessonValidation] = Json.format
  given OFormat[EngineScore] = Json.format
  given OFormat[EngineLine] = Json.format
  given OFormat[EngineAnalysis] = Json.format
  given OFormat[ExplorerMove] = Json.format
  given OFormat[ExplorerResult] = Json.format
  given OFormat[ImportedTreeNode] = Json.format
  given OFormat[ImportedMoveTree] = Json.format
