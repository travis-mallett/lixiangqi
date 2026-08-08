package views.lobby

import lila.app.UiEnv.{ *, given }

object bits:

  // Adapted from WandererXII/lishogi's AGPL-3.0-or-later homepage leaderboard:
  // https://github.com/WandererXII/lishogi/blob/master/app/views/lobby/bits.scala
  // Icon colors follow https://github.com/WandererXII/lishogi/commit/6cc0e9e.
  // Lixiangqi uses its native ranking cache, user links, titles, flags, and routes.

  def homepageLeaderboard(
      leaderboard: List[lila.core.user.LightPerf],
      flags: Map[UserId, lila.core.user.FlagCode]
  )(using ctx: Context) =
    st.section(cls := "lobby__leaderboard lobby__box")(
      header(cls := "lobby__leaderboard__header")(
        h2(cls := "text", dataIcon := Icon.BarChart)(trans.site.leaderboard()),
        a(cls := "more", href := routes.User.list)(trans.site.more(), " »")
      ),
      div(cls := "lobby__leaderboard__scroll")(
        table(
          tbody(
            leaderboard.map: entry =>
              tr(
                td(cls := "lobby__leaderboard__user")(
                  lightUserLink(entry.user, truncate = 18.some),
                  flags
                    .get(entry.user.id)
                    .map: code =>
                      img(
                        cls := "flag",
                        src := assetUrl(s"flags/${code.value}.webp"),
                        alt := "",
                        aria.hidden := "true"
                      )
                ),
                td(
                  cls := "lobby__leaderboard__perf text",
                  dataIcon := entry.perfKey.perfIcon,
                  title := entry.perfKey.perfTrans
                ),
                td(cls := "lobby__leaderboard__rating")(entry.rating),
                td(cls := "lobby__leaderboard__progress")(
                  if entry.progress.positive then
                    span(cls := "is-up text", dataIcon := Icon.ArrowUpRight)(entry.progress.value)
                  else if entry.progress.negative then
                    span(cls := "is-down text", dataIcon := Icon.ArrowDownRight)(-entry.progress.value)
                  else span(cls := "is-flat")("–")
                )
              )
          )
        )
      )
    )

  def showUnreadLichessMessage(using Context) =
    nopeInfo(
      cls := "unread-lichess-message",
      p(trans.site.showUnreadLichessMessage()),
      p:
        a(cls := "button button-fat", href := routes.Msg.convo(UserId.lichess)):
          trans.site.clickHereToReadIt()
    )

  def playbanInfo(ban: lila.playban.TempBan)(using Context) =
    nopeInfo(
      h1(trans.site.sorry()),
      p(trans.site.weHadToTimeYouOutForAWhile()),
      p(strong(timeRemaining(ban.endsAt))),
      h2(trans.site.why()),
      p(
        trans.site.pleasantChessExperience(),
        br,
        trans.site.goodPractice(),
        br,
        trans.site.potentialProblem()
      ),
      h2(trans.site.howToAvoidThis()),
      ul(
        li(trans.site.playEveryGame()),
        li(trans.site.tryToWin()),
        li(trans.site.resignLostGames())
      ),
      p(
        trans.site.temporaryInconvenience(),
        br,
        trans.site.wishYouGreatGames(),
        br,
        trans.site.thankYouForReading()
      )
    )

  def currentGameInfo(current: lila.app.mashup.Preload.CurrentGame)(using Context) =
    nopeInfo(
      h1(trans.site.hangOn()),
      p(trans.site.gameInProgress(strong(current.opponent))),
      br,
      br,
      a(
        cls := "text button button-fat",
        dataIcon := Icon.PlayTriangle,
        href := routes.Round.player(current.pov.fullId)
      )(
        trans.site.joinTheGame()
      ),
      br,
      br,
      "or",
      br,
      br,
      postForm(action := routes.Round.resign(current.pov.fullId))(
        button(cls := "text button button-red", dataIcon := Icon.X):
          if current.pov.game.abortableByUser then trans.site.abortTheGame() else trans.site.resignTheGame()
      ),
      br,
      p(trans.site.youCantStartNewGame())
    )

  def nopeInfo(content: Modifier*) =
    div(cls := "lobby__nope lobby__box"):
      st.section(cls := "lobby__nope__content")(content)
