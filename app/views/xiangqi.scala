package views

import play.api.libs.json.{ JsString, Json }

import lila.app.UiEnv.*

object xiangqi:

  private def analysisBoard =
    st.section(cls := "xiangqi-analysis-board")(
      div(
        id := "xiangqi-eval",
        cls := "xiangqi-eval",
        role := "meter",
        attr("aria-label") := "Pikafish evaluation from Red's perspective",
        attr("aria-valuemin") := "0",
        attr("aria-valuemax") := "100",
        attr("aria-valuenow") := "50"
      )(
        div(id := "xiangqi-eval-fill", cls := "xiangqi-eval__red"),
        span(id := "xiangqi-eval-score", cls := "xiangqi-eval__score")("+0.00")
      ),
      st.section(cls := "main-board xiangqi9x10")(
        div(id := "xiangqi-board", cls := "cg-wrap xiangqi9x10")
      ),
      div(cls := "xiangqi-dock-overlay", attr("aria-hidden") := "true")(
        span(cls := "xiangqi-dock-target", attr("data-dock") := "top")("Top"),
        span(cls := "xiangqi-dock-target", attr("data-dock") := "right")("Right"),
        span(cls := "xiangqi-dock-target", attr("data-dock") := "bottom")("Bottom"),
        span(cls := "xiangqi-dock-target", attr("data-dock") := "left")("Left")
      ),
      span(
        id := "xiangqi-dock-status",
        cls := "xiangqi-dock-status",
        role := "status",
        attr("aria-live") := "polite",
        attr("aria-atomic") := "true"
      )
    )

  private def settingToggle(idValue: String, labelText: String) =
    label(cls := "xiangqi-setting-toggle", attr("for") := idValue)(
      span(labelText),
      input(id := idValue, tpe := "checkbox")
    )

  private def notationLayoutSettings =
    div(cls := "xiangqi-setting-radios", role := "radiogroup", attr("aria-label") := "Notation layout")(
      label(attr("for") := "xiangqi-notation-layout-two-column")(
        input(
          id := "xiangqi-notation-layout-two-column",
          tpe := "radio",
          name := "xiangqi-notation-layout",
          value := "two-column"
        ),
        span("Two column notation")
      ),
      label(attr("for") := "xiangqi-notation-layout-compact")(
        input(
          id := "xiangqi-notation-layout-compact",
          tpe := "radio",
          name := "xiangqi-notation-layout",
          value := "compact"
        ),
        span("Compact notation")
      )
    )

  private def catalogSource(idValue: String, labelText: String, nested: Boolean = false) =
    label(
      cls := s"games-database__source${if nested then " nested" else ""}",
      attr("for") := s"games-source-$idValue"
    )(
      input(
        id := s"games-source-$idValue",
        tpe := "checkbox",
        checked := true,
        attr("data-source") := idValue
      ),
      span(attr("data-source-count") := idValue, attr("data-source-label") := labelText)(labelText)
    )

  def gamesDatabase(explorerEndpoint: String)(using @annotation.unused ctx: Context) =
    Page("Xiangqi Games Database")
      .css("xiangqi")
      .js(PageModule("xiangqi.games", Json.obj("explorerEndpoint" -> explorerEndpoint)))
      .graph(
        title = "Xiangqi Games Database",
        url = routeUrl(routes.GameCatalog.index),
        description = "Search and browse master and online Xiangqi game records."
      )
      .body(
        main(cls := "games-database box")(
          header(cls := "games-database__header")(
            h1("Games Database"),
            p(
              "Search master, DPXQ online, GDChess/01xq, and XQDao collections, then open any game in a new Analysis tab."
            )
          ),
          div(cls := "games-database__layout")(
            st.aside(cls := "games-database__filters", attr("aria-label") := "Game sources")(
              h2("Sources"),
              catalogSource("m", "Master Games"),
              label(cls := "games-database__source parent", attr("for") := "games-source-online")(
                input(
                  id := "games-source-online",
                  tpe := "checkbox",
                  checked := true,
                  attr("data-source-parent") := "online"
                ),
                span(
                  attr("data-source-count") := "online",
                  attr("data-source-label") := "DPXQ Online Games"
                )("DPXQ Online Games")
              ),
              div(cls := "games-database__source-children")(
                catalogSource("n", "Online Tournaments", nested = true),
                catalogSource("t", "Top Games", nested = true),
                catalogSource("k", "Top Blitz Games", nested = true),
                catalogSource("o", "Other Games", nested = true),
                catalogSource("b", "Games Under 24 Moves", nested = true),
                catalogSource("u", "Player Uploads", nested = true),
                catalogSource("w", "Unassigned Games", nested = true)
              ),
              catalogSource("gd", "GDChess / 01xq"),
              catalogSource("xqd", "XQDao")
            ),
            st.section(cls := "games-database__results", attr("aria-label") := "Game records")(
              form(id := "games-database-search", cls := "games-database__search")(
                input(
                  id := "games-database-query",
                  tpe := "search",
                  maxlength := 100,
                  placeholder := "Search players, events, openings, places…",
                  attr("aria-label") := "Search games"
                ),
                button(cls := "button", tpe := "submit")("Search")
              ),
              div(
                id := "games-database-status",
                cls := "games-database__status",
                attr("aria-live") := "polite",
                attr("aria-atomic") := "true"
              )("Loading games…"),
              div(cls := "games-database__table-wrap")(
                table(id := "games-database-table", cls := "slist games-database__table")(
                  thead(
                    tr(
                      th(button(tpe := "button", attr("data-sort") := "source")("Source")),
                      th(button(tpe := "button", attr("data-sort") := "date")("Date")),
                      th(button(tpe := "button", attr("data-sort") := "red")("Red Player")),
                      th(button(tpe := "button", attr("data-sort") := "black")("Black Player")),
                      th(button(tpe := "button", attr("data-sort") := "result")("Result")),
                      th(button(tpe := "button", attr("data-sort") := "event")("Event")),
                      th(cls := "games-database__optional")(
                        button(tpe := "button", attr("data-sort") := "round")("Round")
                      ),
                      th(cls := "games-database__optional")(
                        button(tpe := "button", attr("data-sort") := "moves")("Moves")
                      )
                    )
                  ),
                  tbody(id := "games-database-rows")
                )
              ),
              st.nav(cls := "games-database__pagination", attr("aria-label") := "Games pages")(
                button(id := "games-database-previous", cls := "button button-empty", tpe := "button")(
                  "Previous"
                ),
                span(id := "games-database-page")("Page 1"),
                button(id := "games-database-next", cls := "button button-empty", tpe := "button")("Next")
              )
            )
          )
        )
      )

  def analysis(bootstrap: play.api.libs.json.JsObject = Json.obj())(using ctx: Context) =
    Page("Xiangqi Analysis Board")
      .css("xiangqi")
      .js(
        PageModule(
          "xiangqi.analysis",
          bootstrap + ("notationStyle" -> JsString(ctx.pref.xiangqiNotationStyle(ctx.lang).key))
        )
      )
      .csp(_.withWebAssembly)
      .flag(_.zoom)
      .flag(_.crossSiteIsolation)
      .graph(
        title = "Xiangqi Analysis Board",
        url = routeUrl(routes.UserAnalysis.index),
        description = "Analyse standard Xiangqi positions with legal moves and WXF notation."
      )
      .body(
        main(cls := "xiangqi-page xiangqi-analysis-page")(
          analysisBoard,
          st.aside(cls := "xiangqi-analysis-panel box")(
            st.section(cls := "xiangqi-engine", attr("aria-label") := "Pikafish analysis")(
              div(cls := "bar", attr("aria-hidden") := "true")(span()),
              div(cls := "xiangqi-engine__summary")(
                label(cls := "xiangqi-engine__switch", title := "Enable local Pikafish")(
                  input(id := "xiangqi-engine-enabled", tpe := "checkbox", checked := true),
                  span(attr("aria-hidden") := "true")
                ),
                strong(id := "xiangqi-engine-score", cls := "xiangqi-engine__headline-score")("—"),
                div(cls := "xiangqi-engine__identity")(
                  span(cls := "xiangqi-engine__name")("Pikafish"),
                  span(
                    id := "xiangqi-engine-status",
                    cls := "xiangqi-analysis__substatus",
                    attr("aria-live") := "polite"
                  )("Starting engine…")
                ),
                span(id := "xiangqi-cloud-badge", cls := "xiangqi-cloud-badge", attr("hidden") := true)(
                  "CLOUD"
                ),
                button(
                  id := "xiangqi-engine-settings-button",
                  cls := "xiangqi-icon-button",
                  attr("type") := "button",
                  title := "Pikafish settings",
                  attr("aria-label") := "Pikafish settings",
                  attr("aria-expanded") := "false",
                  dataIcon := Icon.Gear
                )
              ),
              div(id := "xiangqi-engine-settings", cls := "xiangqi-engine-settings", attr("hidden") := true)(
                label(cls := "xiangqi-engine-settings__toggle")(
                  span("Use Cloud Database"),
                  input(id := "xiangqi-engine-use-cloud", tpe := "checkbox", checked := true),
                  span(cls := "xiangqi-engine-settings__toggle-control", attr("aria-hidden") := "true")
                ),
                label(cls := "xiangqi-engine-settings__toggle xiangqi-engine-settings__preview-toggle")(
                  span("Show engine lines preview"),
                  input(id := "xiangqi-engine-lines-preview", tpe := "checkbox", checked := true),
                  span(cls := "xiangqi-engine-settings__toggle-control", attr("aria-hidden") := "true")
                ),
                label(
                  span("Search depth"),
                  input(id := "xiangqi-engine-depth", tpe := "range", min := 10, max := 30, value := 20),
                  span(id := "xiangqi-engine-depth-value", cls := "xiangqi-engine-settings__value")("20")
                ),
                label(
                  span("Multiple lines"),
                  input(id := "xiangqi-engine-multipv", tpe := "range", min := 1, max := 5, value := 3),
                  span(id := "xiangqi-engine-multipv-value", cls := "xiangqi-engine-settings__value")("3 / 5")
                ),
                label(
                  span("Threads"),
                  input(id := "xiangqi-engine-threads", tpe := "range", min := 1, max := 8, value := 2),
                  span(id := "xiangqi-engine-threads-value", cls := "xiangqi-engine-settings__value")("2")
                ),
                label(
                  span("Memory"),
                  input(
                    id := "xiangqi-engine-hash",
                    tpe := "range",
                    min := 16,
                    max := 256,
                    step := 16,
                    value := 64
                  ),
                  span(id := "xiangqi-engine-hash-value", cls := "xiangqi-engine-settings__value")("64 MB")
                ),
                button(id := "xiangqi-analyse-line", cls := "button button-empty", attr("type") := "button")(
                  "Analyse selected line"
                )
              ),
              div(id := "xiangqi-engine-lines", cls := "xiangqi-engine__lines pv_box"),
              button(
                id := "xiangqi-more-lines",
                cls := "xiangqi-engine__more",
                attr("type") := "button",
                attr("hidden") := true,
                attr("aria-expanded") := "false",
                attr("aria-label") := "Show more cloud moves",
                title := "Show more cloud moves",
                dataIcon := Icon.DownTriangle
              )
            ),
            div(cls := "xiangqi-analysis__position-status")(
              span(id := "xiangqi-status", attr("aria-live") := "polite")("Loading Xiangqi position…"),
              span(
                id := "xiangqi-save-status",
                cls := "xiangqi-analysis__substatus",
                attr("aria-live") := "polite"
              )
            ),
            div(
              id := "xiangqi-moves",
              cls := "xiangqi-analysis__moves",
              attr("aria-label") := "WXF move variation tree"
            ),
            st.section(
              id := "xiangqi-explorer",
              cls := "explorer-box sub-box",
              attr("aria-label") := "Opening explorer",
              attr("hidden") := true
            ),
            div(cls := "xiangqi-analysis__nav", attr("aria-label") := "Analysis controls")(
              button(
                id := "xiangqi-explorer-toggle",
                cls := "xiangqi-icon-button",
                attr("type") := "button",
                title := "Opening explorer",
                attr("aria-label") := "Opening explorer",
                attr("aria-pressed") := "false",
                dataIcon := Icon.Book
              ),
              button(
                id := "xiangqi-first",
                cls := "xiangqi-icon-button",
                attr("type") := "button",
                title := "First position",
                attr("aria-label") := "First position",
                dataIcon := Icon.JumpFirst
              ),
              button(
                id := "xiangqi-previous",
                cls := "xiangqi-icon-button",
                attr("type") := "button",
                title := "Previous move",
                attr("aria-label") := "Previous move",
                dataIcon := Icon.LessThan
              ),
              button(
                id := "xiangqi-next",
                cls := "xiangqi-icon-button",
                attr("type") := "button",
                title := "Next move in this line",
                attr("aria-label") := "Next move in this line",
                dataIcon := Icon.GreaterThan
              ),
              button(
                id := "xiangqi-last",
                cls := "xiangqi-icon-button",
                attr("type") := "button",
                title := "End of this line",
                attr("aria-label") := "End of this line",
                dataIcon := Icon.JumpLast
              ),
              button(
                id := "xiangqi-interface-settings-button",
                cls := "xiangqi-icon-button xiangqi-analysis__menu-button",
                attr("type") := "button",
                title := "Board and interface settings",
                attr("aria-label") := "Board and interface settings",
                dataIcon := Icon.Gear
              )
            )
          ),
          st.nav(
            id := "xiangqi-analysis-tabs",
            cls := "xiangqi-analysis__tabs box",
            attr("aria-label") := "Open analyses",
            role := "tablist"
          ),
          st.section(cls := "xiangqi-analysis__underboard box")(
            st.section(
              id := "xiangqi-server-analysis",
              cls := "xiangqi-server-analysis",
              attr("hidden") := true,
              attr("aria-live") := "polite"
            )(
              div(
                strong("Computer analysis"),
                span(id := "xiangqi-server-analysis-status")(
                  "Request a full-game Pikafish analysis."
                )
              ),
              button(
                id := "xiangqi-request-analysis",
                cls := "button",
                attr("type") := "button"
              )("Request computer analysis")
            ),
            div(cls := "xiangqi-analysis__fen")(
              label(attr("for") := "xiangqi-fen")("Position (Xiangqi FEN)"),
              textarea(id := "xiangqi-fen", rows := 2, spellcheck := false),
              div(cls := "xiangqi-analysis__fen-actions")(
                button(id := "xiangqi-load-fen", cls := "button", attr("type") := "button")("Load position"),
                button(id := "xiangqi-copy-fen", cls := "button button-empty", attr("type") := "button")(
                  "Copy FEN"
                ),
                button(id := "xiangqi-reset", cls := "button button-empty", attr("type") := "button")(
                  "Starting position"
                )
              )
            ),
            div(cls := "xiangqi-analysis__notation")(
              label(attr("for") := "xiangqi-notation")(
                "Xiangqi movetext (WXF or UCI, with variations in parentheses)"
              ),
              textarea(
                id := "xiangqi-notation",
                rows := 6,
                spellcheck := false,
                placeholder := "1. P9+1 P1+1 (1... H2+3) 2. P7+1"
              ),
              div(cls := "xiangqi-analysis__fen-actions")(
                button(id := "xiangqi-import-notation", cls := "button", attr("type") := "button")(
                  "Load moves"
                ),
                button(id := "xiangqi-copy-notation", cls := "button button-empty", attr("type") := "button")(
                  "Copy all lines"
                ),
                button(id := "xiangqi-clear-draft", cls := "button button-empty", attr("type") := "button")(
                  "Clear saved draft"
                )
              )
            ),
            p(cls := "xiangqi-note")(
              "Play from an earlier position to create a variation. Right-click or press and hold a move to promote, convert, or delete a line. Pikafish follows the selected line."
            )
          ),
          div(
            id := "xiangqi-interface-settings",
            cls := "xiangqi-interface-settings",
            attr("hidden") := true
          )(
            div(cls := "xiangqi-interface-settings__scrim"),
            div(
              cls := "xiangqi-interface-settings__dialog",
              role := "dialog",
              attr("aria-modal") := "true",
              attr("aria-labelledby") := "xiangqi-interface-settings-title"
            )(
              div(cls := "xiangqi-interface-settings__header")(
                h2(id := "xiangqi-interface-settings-title")("Analysis board"),
                button(
                  id := "xiangqi-interface-settings-close",
                  cls := "xiangqi-icon-button",
                  attr("type") := "button",
                  attr("aria-label") := "Close settings",
                  dataIcon := Icon.X
                )
              ),
              div(cls := "xiangqi-interface-settings__actions")(
                button(id := "xiangqi-flip", attr("type") := "button")(
                  strong(dataIcon := Icon.ChasingArrows),
                  span("Flip board")
                ),
                button(id := "xiangqi-edit-position", attr("type") := "button")(
                  strong(dataIcon := Icon.Pencil),
                  span("Board editor")
                ),
                button(id := "xiangqi-continue-here", attr("type") := "button")(
                  strong(dataIcon := Icon.Swords),
                  span("Continue from here")
                ),
                button(id := "xiangqi-share-position", attr("type") := "button")(
                  strong(dataIcon := Icon.ArrowUpRight),
                  span("Share position")
                )
              ),
              div(cls := "xiangqi-interface-settings__groups")(
                fieldset(
                  legend("Move list"),
                  notationLayoutSettings,
                  settingToggle("xiangqi-setting-inline", "Inline notation"),
                  settingToggle("xiangqi-setting-annotations", "Move evaluations")
                ),
                fieldset(
                  legend("Board"),
                  settingToggle("xiangqi-setting-gauge", "Evaluation gauge"),
                  div(cls := "xiangqi-setting-radios xiangqi-gauge-dock-settings")(
                    span(cls := "xiangqi-gauge-dock-settings__label")("Evaluation bar position"),
                    div(role := "radiogroup", attr("aria-label") := "Evaluation bar position")(
                      Seq("Top", "Right", "Bottom", "Left").map { position =>
                        val value = position.toLowerCase
                        label(attr("for") := s"xiangqi-gauge-dock-$value")(
                          input(
                            id := s"xiangqi-gauge-dock-$value",
                            tpe := "radio",
                            name := "xiangqi-gauge-dock",
                            attr("value") := value
                          ),
                          span(position)
                        )
                      }
                    )
                  ),
                  settingToggle("xiangqi-setting-lock-panels", "Lock panels"),
                  settingToggle("xiangqi-setting-best-arrow", "Best move arrow"),
                  settingToggle("xiangqi-setting-variation-arrows", "Variation arrows"),
                  settingToggle("xiangqi-setting-coordinates", "Board coordinates")
                )
              )
            )
          )
        )
      )
