package lila.puzzle

import lila.db.dsl.*
import lila.memo.CacheApi.buildAsyncTimeout

final private class PuzzleCountApi(
    colls: PuzzleColls,
    cacheApi: lila.memo.CacheApi
)(using Executor, Scheduler):

  private type ThemeCount = Map[PuzzleTheme.Key, Int]

  def countsByTheme: Fu[ThemeCount] =
    colls
      .publication(_.byId[Bdoc]("control"))
      .flatMap: control =>
        byThemeCache.get(control.flatMap(_.string("version")).getOrElse("bootstrap"))

  def byTheme(theme: PuzzleTheme.Key): Fu[Int] =
    countsByTheme.dmap { _.getOrElse(theme, 0) }

  def byAngle(angle: PuzzleAngle): Fu[Int] =
    byTheme(angle.asTheme | PuzzleTheme.mix.key)

  private val byThemeCache =
    cacheApi[String, ThemeCount](initialCapacity = 2, name = "puzzle:themeCount:live"):
      _.expireAfterWrite(1.hour).buildAsyncTimeout(30.seconds): _ =>
        import Puzzle.BSONFields.*
        colls.puzzle:
          _.aggregateList(Int.MaxValue, _.pri): framework =>
            import framework.*
            Match(Puzzle.activeSelector) -> List(
              Project($doc(themes -> true)),
              Unwind(themes),
              GroupField(themes)("nb" -> SumAll)
            )
          .map: objs =>
            for
              obj <- objs
              key <- obj.string("_id")
              count <- obj.int("nb")
            yield PuzzleTheme.Key(key) -> count
          .flatMap: themed =>
            colls
              .puzzle(_.countSel(Puzzle.activeSelector))
              .map: all =>
                themed.toMap + (PuzzleTheme.mix.key -> all.toInt)
