package views.lobby

import lila.app.UiEnv.{ *, given }
import lila.core.rank.RankScore.*

object bits:

  // Adapted from WandererXII/lishogi's AGPL-3.0-or-later homepage leaderboard:
  // https://github.com/WandererXII/lishogi/blob/master/app/views/lobby/bits.scala
  // Icon colors follow https://github.com/WandererXII/lishogi/commit/6cc0e9e.
  // Lixiangqi uses its native ranking cache, user links, titles, flags, and routes.

  def homepageLeaderboard(
      leaderboard: List[lila.core.user.LightRank],
      flags: Map[UserId, lila.core.user.FlagCode],
      personal: Option[lila.user.XiangqiPersonalRank],
      showMoreLink: Boolean = true
  )(using ctx: Context) =
    val ranked = personal.collect { case lila.user.XiangqiPersonalRank.Ranked(place, entry) =>
      place -> entry
    }
    val extra = ranked.filterNot((_, entry) => leaderboard.exists(_.user.id == entry.user.id))
    def row(entry: lila.core.user.LightRank, place: Int) =
      tr(cls := ranked.exists(_._2.user.id == entry.user.id).option("is-me"))(
        td(cls := "lobby__leaderboard__user")(
          lightUserLink(entry.user, truncate = 18.some),
          flags
            .get(entry.user.id)
            .map(code =>
              img(
                cls := "flag",
                src := assetUrl(s"flags/${code.value}.webp"),
                alt := "",
                aria.hidden := "true"
              )
            )
        ),
        td(cls := "lobby__leaderboard__rating")(entry.score.value),
        td(cls := "lobby__leaderboard__rank")(entry.rank.value),
        td(cls := "lobby__leaderboard__place")(place.toString)
      )
    st.section(cls := "lobby__leaderboard lobby__box")(
      header(cls := "lobby__leaderboard__header")(
        h2(
          span(cls := "lobby__leaderboard__icon", aria.hidden := true),
          "Leaderboard"
        ),
        showMoreLink.option(a(cls := "more", href := routes.User.list)("More ›"))
      ),
      div(cls := "lobby__leaderboard__scroll")(
        table(
          colgroup(
            col(cls := "lobby__leaderboard__player-column"),
            col(cls := "lobby__leaderboard__rating-column"),
            col(cls := "lobby__leaderboard__rank-column"),
            col(cls := "lobby__leaderboard__place-column")
          ),
          thead(
            tr(
              th(cls := "lobby__leaderboard__player-heading", attr("scope") := "col")("Player"),
              th(cls := "lobby__leaderboard__rating-heading", attr("scope") := "col")(
                span("Rating"),
                span(cls := "lobby__leaderboard__rating-help")(
                  button(
                    cls := "lobby__leaderboard__rating-info site-tooltip-trigger text",
                    tpe := "button",
                    dataIcon := Icon.InfoCircle,
                    attr("popovertarget") := "xiangqi-rating-help",
                    attrData("tooltip-id") := "xiangqi-rating-help",
                    attrData("tooltip-class") := "lobby__leaderboard__rating-popup-content",
                    attrData("pt-pos") := "n",
                    aria.label := "How Xiangqi ratings change",
                    attr("aria-describedby") := "xiangqi-rating-help"
                  )
                )
              ),
              th(cls := "lobby__leaderboard__rank-heading", attr("scope") := "col")(
                span("Rank"),
                span(cls := "lobby__leaderboard__rating-help")(
                  button(
                    cls := "lobby__leaderboard__rating-info site-tooltip-trigger text",
                    tpe := "button",
                    dataIcon := Icon.InfoCircle,
                    attr("popovertarget") := "xiangqi-rank-help",
                    attrData("tooltip-id") := "xiangqi-rank-help",
                    attrData("tooltip-class") := "lobby__leaderboard__rating-popup-content",
                    attrData("pt-pos") := "n",
                    aria.label := "About Xiangqi ranks",
                    attr("aria-describedby") := "xiangqi-rank-help"
                  )
                )
              ),
              th(cls := "lobby__leaderboard__place-heading", attr("scope") := "col")(trans.site.place())
            )
          ),
          tbody(
            leaderboard.zipWithIndex.map((entry, index) => row(entry, index + 1)),
            extra.nonEmpty.option(tr(cls := "lobby__leaderboard__ellipsis")(td(attr("colspan") := 4)("…"))),
            extra.map((place, entry) => row(entry, place))
          )
        )
      ),
      div(
        id := "xiangqi-rating-help",
        cls := "lobby__leaderboard__rating-popup lobby__leaderboard__rating-popup-content",
        attr("popover") := "auto",
        aria.label := "How Xiangqi ratings change"
      )(
        p("Ratings are zero-sum: points gained by one player are lost by the other."),
        ul(
          li("Same-rank win: +10 / −10"),
          li("Lower rank beats an adjacent rank: +15 / −15"),
          li("Higher rank beats an adjacent rank: +5 / −5"),
          li("Draw: no change")
        ),
        p(cls := "lobby__leaderboard__rating-more")(
          a(href := routes.Learn.xiangqiRankings)("Learn More")
        )
      ),
      div(
        id := "xiangqi-rank-help",
        cls := "lobby__leaderboard__rating-popup lobby__leaderboard__rating-popup-content",
        attr("popover") := "auto",
        aria.label := "About Xiangqi ranks"
      )(
        p("Xiangqi ranks are categorized into three levels:"),
        dl(
          div(dt("学"), dd("Student Rank")),
          div(dt("业"), dd("Amateur Rank")),
          div(dt("专"), dd("Professional Rank"))
        ),
        p("Each level is divided into multiple sub-levels:"),
        ul(
          li("学1-1 to 学3-3"),
          li("业1-1 to 业9-3"),
          li("专1-1 to 专3-3")
        ),
        p(cls := "lobby__leaderboard__rating-more")(
          a(href := routes.Learn.xiangqiRankings)("Learn More")
        )
      ),
      personal match
        case None =>
          p(cls := "lobby__leaderboard__footer")(
            a(href := s"${routes.Auth.login.url}?referrer=${ctx.req.path}")(
              trans.site.loginToSeeYourRanking()
            )
          )
        case Some(lila.user.XiangqiPersonalRank.Unplayed) =>
          p(cls := "lobby__leaderboard__footer")(
            a(href := routes.Round.matchmaking("15+0-m90-30x3"))(trans.site.playRatedGameToGetRanked())
          )
        case _ => emptyFrag
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
