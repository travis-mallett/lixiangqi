package lila.puzzle

import chess.IntRating
import chess.rating.IntRatingDiff
import scalalib.model.Days
import play.api.i18n.Lang
import play.api.libs.json.*

import lila.common.Json.given
import lila.core.i18n.Translate
import lila.core.net.ApiVersion
import lila.xiangqi.XiangqiJson.given

final class JsonView(
    gameJson: GameJson,
    myEngines: lila.core.misc.analysis.MyEnginesAsJson
)(using Executor):

  import JsonView.{ *, given }

  def apply(
      puzzle: Puzzle,
      angle: Option[PuzzleAngle],
      replay: Option[PuzzleReplay],
      withInitialPos: Boolean = false
  )(using Translate)(using Option[Me], Perf): Fu[JsObject] =
    gameJson(puzzle, bc = false).map: gameJson =>
      puzzleAndGamejson(puzzle, gameJson, withInitialPos = withInitialPos)
        .add("user" -> userJson)
        .add("replay" -> replay.map(replayJson))
        .add(
          "angle",
          angle.map: a =>
            Json
              .toJsObject(a)
              .add("chapter" -> a.asTheme.flatMap(PuzzleTheme.studyChapterIds.get))
        )

  def analysis(
      puzzle: Puzzle,
      angle: PuzzleAngle,
      replay: Option[lila.puzzle.PuzzleReplay] = None,
      newMe: Option[Me] = None,
      apiVersion: Option[ApiVersion] = None
  )(using oldMe: Option[Me])(using Perf, Translate): Fu[JsObject] =
    given me: Option[Me] = newMe.orElse(oldMe)
    for
      puzzleJson <-
        if apiVersion.exists(v => !ApiVersion.puzzleV2(v))
        then bc(puzzle)
        else apply(puzzle, angle.some, replay)
      enginesJson <- myEngines.get(me)
    yield puzzleJson ++ enginesJson

  def streak(puzzle: Puzzle, ids: String)(using Translate, Option[Me], Perf) =
    for puzzleJson <- analysis(puzzle, PuzzleAngle.mix)
    yield (puzzleJson ++ Json.obj("streak" -> ids), puzzle)

  def userJson(using perf: Perf, me: Option[Me]) = me.isDefined.option:
    Json
      .obj("rating" -> perf.intRating)
      .add("provisional" -> perf.provisional)

  private def replayJson(r: PuzzleReplay) =
    Json.obj("days" -> r.days, "i" -> r.i, "of" -> r.nb)

  object roundJson:
    def web(round: PuzzleRound, perf: Perf)(using prevPerf: Perf) =
      base(round, (perf.intRating - prevPerf.intRating).into(IntRatingDiff))
        .add("vote" -> round.vote)
        .add("themes" -> round.nonEmptyThemes.map: rt =>
          JsObject:
            rt.map: t =>
              t.theme.value -> JsBoolean(t.vote))

    def api = base
    private def base(round: PuzzleRound, ratingDiff: IntRatingDiff) = Json.obj(
      "id" -> round.id.puzzleId,
      "win" -> round.win,
      "ratingDiff" -> ratingDiff
    )

  def pref(p: lila.core.pref.Pref)(using lang: Lang) =
    Json.obj(
      "coords" -> p.coords,
      "keyboardMove" -> p.keyboardMove,
      "voiceMove" -> p.voice,
      "rookCastle" -> p.rookCastle,
      "animation" -> Json.obj("duration" -> p.animationMillis),
      "destination" -> p.destination,
      "moveEvent" -> p.moveEvent,
      "highlight" -> p.highlight,
      "notationStyle" -> p.xiangqiNotationStyle(lang).key
    )

  def dashboardJson(dash: PuzzleDashboard, days: Days)(using Translate) = Json.obj(
    "days" -> days,
    "global" -> dashboardResults(dash.global),
    "themes" -> JsObject(dash.byTheme.toList.sortBy(-_._2.nb).map { (key, res) =>
      key.value -> Json.obj(
        "theme" -> PuzzleTheme(key).name.txt(),
        "results" -> dashboardResults(res)
      )
    })
  )

  private def dashboardResults(res: PuzzleDashboard.Results) = Json.obj(
    "nb" -> res.nb,
    "firstWins" -> res.firstWins,
    "replayWins" -> res.fixed,
    "puzzleRatingAvg" -> res.puzzleRatingAvg,
    "performance" -> res.performance
  )

  def batch(puzzles: Seq[Puzzle])(using me: Option[Me], perf: Perf): Fu[JsObject] =
    Future
      .sequence(
        puzzles.map: puzzle =>
          gameJson(puzzle, bc = false).map:
            puzzleAndGamejson(puzzle, _, withInitialPos = false)
      )
      .map: jsons =>
        import lila.rating.Glicko.glickoWrites
        Json.obj("puzzles" -> jsons).add("glicko" -> me.map(_ => perf.glicko))

  object bc:

    def apply(puzzle: Puzzle)(using me: Option[Me], perf: Perf): Fu[JsObject] =
      gameJson(puzzle, bc = true).map: gameJson =>
        Json
          .obj(
            "game" -> gameJson,
            "puzzle" -> puzzleJson(puzzle)
          )
          .add("user" -> me.map(_ => perf.intRating).map(userJson))

    def batch(puzzles: Seq[Puzzle])(using me: Option[Me], perf: Perf): Fu[JsObject] =
      Future
        .sequence(
          puzzles.map: puzzle =>
            gameJson(puzzle, bc = true).map { gameJson =>
              Json.obj(
                "game" -> gameJson,
                "puzzle" -> puzzleJson(puzzle)
              )
            }
        )
        .map: jsons =>
          Json
            .obj("puzzles" -> jsons)
            .add("user" -> me.map(_ => perf.intRating).map(userJson))

    def userJson(rating: IntRating) = Json.obj(
      "rating" -> rating,
      "recent" -> Json.arr()
    )

    private def puzzleJson(puzzle: Puzzle) = Json.obj(
      "id" -> Puzzle.numericalId(puzzle.id),
      "realId" -> puzzle.id,
      "rating" -> puzzle.glicko.intRating,
      "attempts" -> puzzle.plays,
      "fen" -> puzzle.fen,
      "color" -> puzzle.color.name,
      "initialPly" -> (puzzle.initialPly + 1),
      "gameId" -> puzzle.gameId,
      "lines" -> puzzle.line.tail.reverse.foldLeft[JsValue](JsString("win")): (acc, move) =>
        Json.obj(move.value -> acc),
      "vote" -> 0
    )

object JsonView:

  given (using Translate): OWrites[PuzzleAngle] = a =>
    Json
      .obj(
        "key" -> a.key,
        "name" -> {
          if a == PuzzleAngle.mix
          then lila.core.i18n.I18nKey.puzzle.puzzleThemes.txt()
          else a.name.txt()
        },
        "desc" -> a.description.txt()
      )

  given OWrites[PuzzleReplay] = Json.writes[PuzzleReplay]

  def puzzleAndGamejson(puzzle: Puzzle, game: JsObject, withInitialPos: Boolean) = Json.obj(
    "variant" -> "xiangqi",
    "game" -> game,
    "puzzle" -> {
      puzzleJsonBase(puzzle) ++
        withInitialPos.so(puzzleJsonInitialPos(puzzle)) ++
        Json.obj("initialPly" -> puzzle.initialPly)
    }
  )

  def puzzleJsonStandalone(puzzle: Puzzle): JsObject =
    puzzleJsonBase(puzzle) ++ puzzleJsonInitialPos(puzzle)

  private def puzzleJsonBase(puzzle: Puzzle): JsObject = Json.obj(
    "id" -> puzzle.id,
    "rating" -> puzzle.glicko.intRating,
    "plays" -> puzzle.plays,
    "solution" -> puzzle.line.tail.map(_.value),
    "themes" -> simplifyThemes(puzzle.themes),
    "state" -> puzzle.stateAfterInitialMove,
    "displayFen" -> puzzle.fenAfterInitialMove
  )
  private def simplifyThemes(themes: Set[PuzzleTheme.Key]) =
    themes.filterNot(_ == PuzzleTheme.mate.key)

  private def puzzleJsonInitialPos(puzzle: Puzzle): JsObject = Json.obj(
    "state" -> puzzle.stateAfterInitialMove,
    "displayFen" -> puzzle.fenAfterInitialMove,
    "fen" -> puzzle.fenAfterInitialMove,
    "lastMove" -> puzzle.line.head.value
  )

  def angles(all: PuzzleAngle.All)(using Translate) = Json.obj(
    "themes" -> JsObject:
      all.themes.map: (i18n, themes) =>
        i18n.txt() -> JsArray:
          themes.map:
            case PuzzleTheme.WithCount(theme, count) =>
              Json.obj(
                "key" -> theme.key,
                "name" -> theme.name.txt(),
                "desc" -> theme.description.txt(),
                "count" -> count
              )
  )
