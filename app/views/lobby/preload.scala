package views.lobby

import lila.app.UiEnv.{ *, given }

/** First-paint content for the lobby widget. Share its layout classes so hydration does not move the page. */
object preload:
  def table(using ctx: Context) =
    val pool = lila.pool.PoolList.homepage.head
    div(cls := "lobby__table", aria.busy := "true")(
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
                  trans.site.minutesShort(pool.clock.limitInMinutes)
                )
              )
            ),
            ctx.isAnon.option(
              span(cls := "lobby__feature-card__sign-in")(trans.site.signInToPlayRatedXiangqi())
            )
          )
        ),
        img(
          cls := "lobby__feature-card__image",
          src := assetUrl("images/homepage/xiangqi-evaluation-mode.webp"),
          alt := "",
          widthA := 320,
          heightA := 320,
          attr("decoding") := "async"
        ),
        span(cls := "lobby__feature-card__chevron text", dataIcon := Icon.GreaterThan, aria.hidden := "true")
      ),
      div(cls := "lobby__time-controls__summary")(
        span(
          cls := "lobby__time-controls__chevron text",
          dataIcon := Icon.GreaterThan,
          aria.hidden := "true"
        ),
        span(cls := "lobby__time-controls__label")(
          span(cls := "lobby__label-en lobby__label-en--primary")(trans.site.otherTimeControls())
        )
      ),
      div(cls := "lobby__actions")(
        button(cls := "lobby__action lobby__action--ai", disabled, tpe := "button")(
          span(cls := "lobby__svg-icon lobby__svg-icon--computer", aria.hidden := "true"),
          span(cls := "lobby__action__label")(
            span(cls := "lobby__label-en lobby__label-en--primary")(trans.site.playAgainstComputer())
          )
        ),
        a(cls := "lobby__action lobby__action--puzzle", href := routes.Puzzle.themes)(
          span(cls := "lobby__svg-icon lobby__svg-icon--puzzle", aria.hidden := "true"),
          span(cls := "lobby__action__label")(
            span(cls := "lobby__label-en lobby__label-en--primary")(trans.site.puzzles())
          )
        )
      )
    )
