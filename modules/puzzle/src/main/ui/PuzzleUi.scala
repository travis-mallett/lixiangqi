package lila.puzzle
package ui

import play.api.libs.json.*
import scalalib.paginator.Paginator

import lila.common.Json.given
import lila.core.i18n.I18nKey
import lila.ui.*

import ScalatagsTemplate.{ *, given }

final class PuzzleUi(helpers: Helpers, val bits: PuzzleBits)(
    analyseCsp: Update[ContentSecurityPolicy],
    externalEngineEndpoint: String
):
  import helpers.{ *, given }

  def show(
      puzzle: lila.puzzle.Puzzle,
      data: JsObject,
      pref: JsObject,
      settings: lila.puzzle.PuzzleSettings,
      langPath: Option[lila.ui.LangPath] = None
  )(using ctx: Context) =
    showPage(
      id = puzzle.id.value,
      pov = puzzle.color.name,
      plays = puzzle.plays,
      image = cdnUrl(
        routes.Export.puzzleThumbnail(puzzle.id, ctx.pref.boardTheme.some, ctx.pref.pieceSet.some).url
      ).some,
      data = data,
      pref = pref,
      settings = settings,
      langPath = langPath
    )

  private def showPage(
      id: String,
      pov: String,
      plays: Int,
      image: Option[lila.core.data.Url],
      data: JsObject,
      pref: JsObject,
      settings: lila.puzzle.PuzzleSettings,
      langPath: Option[lila.ui.LangPath]
  )(using ctx: Context) =
    val isStreak = data.value.contains("streak")
    Page(if isStreak then "Puzzle Streak" else trans.site.puzzles.txt())
      .css("puzzle")
      .css(ctx.pref.hasKeyboardMove.option("keyboardMove"))
      .css(ctx.pref.hasVoice.option("voice"))
      .css(ctx.blind.option("round.nvui"))
      .i18n(_.puzzle, _.puzzleTheme)
      .i18nOpt(ctx.speechSynthesis, _.nvui)
      .i18nOpt(ctx.blind, _.keyboardMove)
      .js(ctx.blind.option(Esm("puzzle.nvui")))
      .js(
        PageModule(
          "puzzle",
          Json
            .obj(
              "data" -> data,
              "pref" -> pref,
              "showRatings" -> ctx.pref.showRatings,
              "settings" -> Json.obj("difficulty" -> settings.difficulty.key).add("color" -> settings.color),
              "externalEngineEndpoint" -> externalEngineEndpoint
            )
            .add("themes" -> ctx.isAuth.option(bits.jsonThemes))
        )
      )
      .csp(analyseCsp)
      .graph(
        OpenGraph(
          image = image,
          title =
            if isStreak then "Puzzle Streak"
            else s"Xiangqi tactic #$id - ${pov.capitalize} to play",
          url = routeUrl(routes.Puzzle.show(id)),
          description =
            if isStreak then trans.puzzle.streakDescription.txt()
            else
              val findMove =
                if pov == "white" then trans.puzzle.findTheBestMoveForWhite.txt()
                else trans.puzzle.findTheBestMoveForBlack.txt()
              s"Lixiangqi tactic trainer: $findMove. Played by $plays players."
        )
      )
      .hrefLangs(langPath)
      .flag(_.zoom)
      .flag(_.zen)
      .flag(_.crossSiteIsolation):
        bits.show.preload

  def themes(all: PuzzleAngle.All)(using ctx: Context) =
    Page(trans.puzzle.puzzleThemes.txt())
      .css("puzzle.page")
      .hrefLangs(lila.ui.LangPath(routes.Puzzle.themes)):
        main(cls := "page-menu")(
          bits.pageMenu("themes", ctx.me),
          div(cls := "page-menu__content box")(
            h1(cls := "box__top")(trans.puzzle.puzzleThemes()),
            standardFlash.map(div(cls := "box__pad")(_)),
            div(cls := "puzzle-themes")(
              all.themes.map(themeCategory),
              themeInfo
            )
          )
        )

  private def themeInfo(using Context) =
    p(cls := "puzzle-themes__db text", dataIcon := Icon.Heart):
      trans.puzzleTheme.puzzleDownloadInformation:
        a(href := "https://database.lixiangqi.org/")("database.lixiangqi.org")

  private def themeCategory(cat: I18nKey, themes: List[PuzzleTheme.WithCount])(using Context) =
    frag(
      h2(id := cat.value)(cat()),
      div(cls := s"puzzle-themes__list ${cat.value.replace(":", "-")}")(
        themes.map: pt =>
          val url =
            if pt.theme == PuzzleTheme.mix then routes.Puzzle.home
            else routes.Puzzle.show(pt.theme.key.value)
          a(
            cls := "puzzle-themes__link",
            href := (pt.count > 0).option(langHref(url))
          )(
            img(src := assetUrl(s"images/puzzle-themes/${iconFile(pt.theme.key)}.svg")),
            span(
              h3(
                pt.theme.name(),
                em(cls := "puzzle-themes__count")(pt.count.localize)
              ),
              span(pt.theme.description())
            )
          )
      )
    )

  private def iconFile(theme: PuzzleTheme.Key): String =
    if theme.value.startsWith("mateIn") then "mate"
    else theme.value

  def ofPlayer(query: String, user: Option[User], puzzles: Option[Paginator[Puzzle]])(using ctx: Context) =
    val title: String = (user, puzzles).tupled match
      case Some(u, pager) =>
        trans.puzzle.puzzlesFoundInUserGames.pluralTxt(pager.nbResults, pager.nbResults.localize, u.username)
      case _ => trans.puzzle.lookupOfPlayer.txt()
    Page(title)
      .css("puzzle.page")
      .js(infiniteScrollEsmInit):
        main(cls := "page-menu")(
          bits.pageMenu("player", user),
          div(cls := "page-menu__content puzzle-of-player box box-pad")(
            form(
              action := routes.Puzzle.ofPlayer(),
              method := "get",
              cls := "form3 puzzle-of-player__form complete-parent"
            )(
              st.input(
                name := "name",
                value := query,
                cls := "form-control user-autocomplete",
                placeholder := trans.clas.lichessUsername.txt(),
                autocomplete := "off",
                dataTag := "span",
                autofocus
              ),
              submitButton(cls := "button")(trans.puzzle.searchPuzzles.txt())
            ),
            div(cls := "puzzle-of-player__results"):
              (user, puzzles).tupled.map: (u, pager) =>
                if pager.nbResults == 0 && ctx.is(u) then p(trans.puzzle.fromMyGamesNone())
                else
                  frag(
                    p(
                      strong(
                        trans.puzzle.puzzlesFoundInUserGames
                          .plural(pager.nbResults, pager.nbResults.localize, userLink(u))
                      )
                    ),
                    div(cls := "puzzle-of-player__pager infinite-scroll")(
                      pager.currentPageResults.map { puzzle =>
                        div(cls := "puzzle-of-player__puzzle")(
                          xiangqiGroundMini(
                            fen = puzzle.fenAfterInitialMove,
                            color = puzzle.color,
                            lastMove = puzzle.line.head.value.some
                          )(
                            a(
                              cls := s"puzzle-of-player__puzzle__board",
                              href := routes.Puzzle.show(puzzle.id.value)
                            )
                          ),
                          span(cls := "puzzle-of-player__puzzle__meta")(
                            span(cls := "puzzle-of-player__puzzle__id", s"#${puzzle.id}"),
                            span(cls := "puzzle-of-player__puzzle__rating", puzzle.glicko.intRating)
                          )
                        )
                      },
                      pagerNext(pager, np => s"${routes.Puzzle.ofPlayer(u.username.some, np).url}")
                    )
                  )
          )
        )

  object history:
    import lila.puzzle.PuzzleHistory.{ PuzzleSession, SessionRound }

    def apply(user: User, pager: Paginator[PuzzleSession])(using ctx: Context) =
      val title =
        if ctx.is(user) then trans.puzzle.history.txt()
        else s"${user.username} ${trans.puzzle.history.txt()}"
      Page(title)
        .css("puzzle.dashboard")
        .js(infiniteScrollEsmInit):
          main(cls := "page-menu")(
            bits.pageMenu("history", user.some),
            div(cls := "page-menu__content box box-pad")(
              h1(cls := "box__top")(title),
              div(cls := "puzzle-history")(
                div(cls := "infinite-scroll")(
                  pager.currentPageResults.map(renderSession),
                  pagerNext(pager, np => routes.Puzzle.history(np, user.username.some).url)
                )
              )
            )
          )

    private def renderSession(session: PuzzleSession)(using Context) =
      div(cls := "puzzle-history__session")(
        h2(cls := "puzzle-history__session__title")(
          strong(session.angle.name()),
          momentFromNow(session.puzzles.head.round.date)
        ),
        div(cls := "puzzle-history__session__rounds")(session.puzzles.toList.reverse.map(renderRound))
      )

    private def renderRound(r: SessionRound)(using Context) =
      a(
        cls := List("puzzle-history__round" -> true, "good" -> r.round.win.yes, "bad" -> r.round.win.no),
        href := routes.Puzzle.show(r.puzzle.id.value)
      )(
        xiangqiGroundMini(r.puzzle.fenAfterInitialMove, r.puzzle.color, r.puzzle.line.head.value.some)(
          span(cls := "puzzle-history__round__puzzle")
        ),
        span(cls := "puzzle-history__round__meta")(
          span(cls := "puzzle-history__round__result")(
            if r.round.win.yes then goodTag(trans.puzzle.solved())
            else badTag(trans.puzzle.failed())
          ),
          span(cls := "puzzle-history__round__id")(s"#${r.puzzle.id}")
        )
      )
