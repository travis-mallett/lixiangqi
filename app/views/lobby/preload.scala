package views.lobby

import lila.app.UiEnv.{ *, given }

/** First-paint content for the lobby widget. Share its layout classes so hydration does not move the page. */
object preload:
  def table(using ctx: Context) =
    val pool = lila.pool.PoolList.homepage.head
    div(cls := "lobby__table", aria.busy := "true")(
      st.section(cls := "lobby__match")(
        div(cls := "lobby__match-tabs")(
          List(
            (Icon.LineGraph, trans.site.ratedXiangqi(), true),
            (Icon.Group, trans.site.lobby(), false),
            (Icon.Envelope, trans.site.correspondence(), false)
          ).map: (icon, label, selected) =>
            button(tpe := "button", dataIcon := icon, attr("aria-selected") := selected.toString)(label)
        ),
        div(id := "home-match-panel")(
          a(
            cls := s"lobby__feature-card lobby__feature-card--evaluation${ctx.isAnon.so(" lobby__feature-card--anonymous")}",
            href := routes.Round.matchmaking(pool.id.value)
          )(
            span(cls := "lobby__feature-card__content")(
              span(cls := "lobby__feature-card__divider", aria.hidden := "true"),
              span(cls := "lobby__feature-card__body")(
                span(cls := "lobby__feature-card__heading")(
                  span(cls := "lobby__label-zh")(trans.site.chessPerformanceEvaluationChinese()),
                  span(cls := "lobby__label-en")(trans.site.playRatedXiangqi())
                ),
                span(cls := "lobby__feature-card__meta")(
                  span(
                    trans.site.standard(),
                    span(cls := "lobby__feature-card__separator", aria.hidden := "true")(" · "),
                    span(cls := "lobby__feature-card__time")(
                      trans.site.minutesShort(
                        BigDecimal(pool.clock.limitInMinutes).bigDecimal.stripTrailingZeros.toPlainString
                      )
                    )
                  )
                ),
                span(cls := "button lobby__play-now", dataIcon := Icon.PlayTriangle)(trans.site.playNow()),
                ctx.isAnon.option(
                  span(cls := "lobby__feature-card__sign-in")(trans.site.signInToPlayRatedXiangqi())
                )
              )
            )
          )
        )
      ),
      div(cls := "lobby__actions")(
        button(cls := "button button-metal lobby__action lobby__action--ai", disabled, tpe := "button")(
          span(cls := "lobby__svg-icon lobby__svg-icon--computer", aria.hidden := "true"),
          trans.site.playAgainstComputer()
        ),
        a(cls := "button button-metal lobby__action", href := routes.Puzzle.themes)(
          span(cls := "lobby__svg-icon lobby__svg-icon--puzzle", aria.hidden := "true"),
          trans.site.puzzles()
        ),
        button(cls := "button button-metal lobby__action", disabled, tpe := "button")(
          span(dataIcon := Icon.Swords, aria.hidden := "true"),
          trans.site.challengeAFriend()
        )
      )
    )
