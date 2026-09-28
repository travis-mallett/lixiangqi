package lila.puzzle.ui

import play.api.libs.json.Json

import lila.ui.*
import ScalatagsTemplate.{ *, given }

final class PuzzleThemeLessonUi(helpers: Helpers):
  import helpers.{ *, given }

  def apply(lesson: PuzzleThemeLesson, practiceUrl: Option[String])(using Context) =
    details(
      cls := "puzzle-theme-lesson",
      id := s"${lesson.theme.key.value}-lesson",
      attr("data-lesson") := Json.stringify(lesson.playback)
    )(
      summary(cls := "puzzle-themes__learn text", dataIcon := Icon.Book)(trans.site.learnMenu()),
      div(cls := "puzzle-theme-lesson__content")(
        button(
          cls := "puzzle-theme-lesson__close",
          tpe := "button",
          dataIcon := Icon.X,
          title := trans.site.close.txt(),
          attr("aria-label") := trans.site.close.txt(),
          attr("data-close") := trans.site.close.txt(),
          attr("data-back") := trans.puzzleTheme.backToLesson.txt()
        ),
        div(cls := "puzzle-theme-lesson__stage")(
          div(cls := "puzzle-theme-lesson__overview")(
            div(cls := "puzzle-theme-lesson__media")(
              button(
                cls := "puzzle-theme-lesson__play",
                tpe := "button",
                attr("aria-label") := trans.puzzleTheme.watchLesson.txt()
              )(
                img(
                  src := s"https://img.youtube.com/vi/${lesson.videoId}/0.jpg",
                  alt := "",
                  attr("loading") := "lazy"
                ),
                span(cls := "button", dataIcon := Icon.PlayTriangle, attr("aria-hidden") := "true")
              ),
              div(
                cls := "puzzle-theme-lesson__explanation",
                role := "region",
                attr("aria-label") := trans.puzzleTheme.lessonPattern.txt()
              )(
                h3(trans.puzzleTheme.lessonPattern()),
                ul(
                  li(lesson.pattern()),
                  li(lesson.finish())
                )
              )
            ),
            div(cls := "puzzle-theme-lesson__board main-board")(
              div(
                cls := "cg-wrap",
                role := "img",
                attr("aria-label") := lesson.theme.name.txt()
              )
            ),
            a(cls := "puzzle-theme-lesson__practice button", href := practiceUrl)(
              trans.puzzleTheme.practiceNow()
            )
          ),
          div(cls := "puzzle-theme-lesson__player", hidden)(
            iframe(
              attr("data-src") := lesson.videoEmbedUrl,
              title := lesson.theme.name.txt(),
              attr("allowfullscreen") := true,
              frame.credentialless,
              attr("allow") := "autoplay; encrypted-media; picture-in-picture; fullscreen",
              attr("referrerpolicy") := "strict-origin-when-cross-origin"
            )
          )
        )
      )
    )
