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
      attr("for") := s"games-source-$idValue",
      attr("data-source-item") := idValue
    )(
      input(
        id := s"games-source-$idValue",
        tpe := "checkbox",
        checked := true,
        attr("data-source") := idValue
      ),
      span(attr("data-source-count") := idValue, attr("data-source-label") := labelText)(labelText)
    )

  private def playerCatalogSource(idValue: String, sourceIds: String, labelText: String) =
    label(
      cls := "player-database__source",
      attr("for") := s"player-source-$idValue"
    )(
      input(
        id := s"player-source-$idValue",
        tpe := "checkbox",
        checked := true,
        attr("data-player-sources") := sourceIds
      ),
      span(
        attr("data-player-source-label") := labelText,
        attr("data-player-source-count") := idValue
      )(labelText)
    )

  private def eventCatalogSource(idValue: String, sourceIds: String, labelText: String) =
    label(
      cls := "player-database__source",
      attr("for") := s"event-source-$idValue"
    )(
      input(
        id := s"event-source-$idValue",
        tpe := "checkbox",
        checked := true,
        attr("data-event-sources") := sourceIds
      ),
      span(
        attr("data-event-source-label") := labelText,
        attr("data-event-source-count") := idValue
      )(labelText)
    )

  private def playerOutcome(idValue: String, titleText: String, description: String) =
    st.article(cls := "player-database__outcome")(
      div(cls := "player-database__outcome-heading")(
        div(
          h3(titleText),
          p(description)
        ),
        strong(id := s"player-$idValue-games")("—")
      ),
      div(
        id := s"player-$idValue-bar",
        cls := "player-database__outcome-bar",
        role := "img",
        attr("aria-label") := s"$titleText win, draw, and loss percentages"
      )(
        span(cls := "wins"),
        span(cls := "draws"),
        span(cls := "losses")
      ),
      div(cls := "player-database__outcome-legend")(
        span(cls := "wins")(strong(id := s"player-$idValue-wins")("—"), " win"),
        span(cls := "draws")(strong(id := s"player-$idValue-draws")("—"), " draw"),
        span(cls := "losses")(strong(id := s"player-$idValue-losses")("—"), " loss")
      )
    )

  def gamesDatabase(explorerEndpoint: String, nativeWeeklyAdded: Int)(using
      @annotation.unused ctx: Context
  ) =
    Page("Xiangqi Games Database")
      .css("xiangqi")
      .js(
        PageModule(
          "xiangqi.games",
          Json.obj(
            "explorerEndpoint" -> explorerEndpoint,
            "nativeWeeklyAdded" -> nativeWeeklyAdded
          )
        )
      )
      .graph(
        title = "Xiangqi Games Database",
        url = routeUrl(routes.GameCatalog.index),
        description = "Search and browse master and online Xiangqi game records."
      )
      .body(
        main(cls := "games-database box")(
          header(cls := "games-database__header")(
            div(cls := "games-database__intro")(
              h1("Games Database"),
              p(
                cls := "games-database__total",
                attr("aria-live") := "polite",
                attr("aria-atomic") := "true"
              )(
                strong(id := "games-database-total-unique")("—"),
                span("total unique games")
              ),
              p(cls := "games-database__description")(
                "Search master games, ancient manuals, DPXQ online games, GDChess/01xq, XQDao, and Elephantchess.io collections, then open any record in a new Analysis tab."
              )
            ),
            div(
              id := "games-database-weekly",
              cls := "games-database__weekly",
              title := "Counts new catalog records and Lixiangqi games since Sunday at midnight Pacific time",
              attr("aria-live") := "polite",
              attr("aria-atomic") := "true"
            )(
              strong(id := "games-database-weekly-count")(nativeWeeklyAdded.toString),
              span(id := "games-database-weekly-label")(
                if nativeWeeklyAdded == 1 then "new game added this week!"
                else "new games added this week!"
              ),
              small("Resets weekly · Pacific time")
            )
          ),
          div(cls := "games-database__layout")(
            st.aside(cls := "games-database__filters", attr("aria-label") := "Game sources")(
              h2("Sources"),
              catalogSource("m", "Master Games"),
              catalogSource("am", "Ancient Manuals"),
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
              catalogSource("xqd", "XQDao"),
              catalogSource("ec", "Elephantchess.io")
            ),
            st.section(cls := "games-database__results", attr("aria-label") := "Game records")(
              st.section(
                cls := "games-database__timeline",
                attr("aria-labelledby") := "games-database-timeline-title"
              )(
                div(cls := "games-database__timeline-header")(
                  div(
                    h2(id := "games-database-timeline-title")("Game timeline"),
                    p(id := "games-database-timeline-summary")(
                      "Loading the distribution of matching games…"
                    )
                  ),
                  label(cls := "games-database__timeline-unit", attr("for") := "games-database-time-unit")(
                    span("Time unit"),
                    select(id := "games-database-time-unit")(
                      option(value := "month")("Month"),
                      option(value := "year", selected := true)("Year"),
                      option(value := "decade")("Decade")
                    )
                  )
                ),
                div(
                  id := "games-database-timeline-chart",
                  cls := "games-database__timeline-chart",
                  role := "img",
                  attr("aria-label") := "Timeline of games matching the current source and search filters"
                ),
                p(
                  id := "games-database-timeline-empty",
                  cls := "games-database__timeline-empty",
                  attr("hidden") := true
                )("No dated games match these filters.")
              ),
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

  def databasePlayer(explorerEndpoint: String, player: String)(using
      @annotation.unused ctx: Context
  ) =
    Page(s"$player — Games Database")
      .css("xiangqi")
      .js(
        PageModule(
          "xiangqi.player",
          Json.obj(
            "explorerEndpoint" -> explorerEndpoint,
            "player" -> player
          )
        )
      )
      .graph(
        title = s"$player — Xiangqi player database",
        url = routeUrl(routes.GameCatalog.player(player)),
        description = s"Games, results, timeline, opponents, and opening repertoire for $player."
      )
      .body(
        main(cls := "player-database box")(
          header(cls := "player-database__header")(
            div(
              a(cls := "player-database__back", href := routes.GameCatalog.index.url)("← Games Database"),
              h1(id := "player-database-name")(player),
              p(id := "player-database-range", cls := "player-database__range")(
                "Loading this player’s database record…"
              )
            ),
            div(
              id := "player-database-status",
              cls := "player-database__status",
              role := "status",
              attr("aria-live") := "polite",
              attr("aria-atomic") := "true"
            )("Loading player statistics…")
          ),
          div(id := "player-database-content", attr("hidden") := true)(
            st.section(cls := "player-database__metrics", attr("aria-label") := "Player summary")(
              st.article(
                span("Games"),
                strong(id := "player-metric-games")("—"),
                small("recorded games")
              ),
              st.article(
                span("Score"),
                strong(id := "player-metric-score")("—"),
                small("points won")
              ),
              st.article(
                span("Opponents"),
                strong(id := "player-metric-opponents")("—"),
                small("distinct opponents")
              ),
              st.article(
                span("Average rating"),
                strong(id := "player-metric-rating")("—"),
                small("when recorded")
              ),
              st.article(
                span("Average length"),
                strong(id := "player-metric-moves")("—"),
                small("half-moves")
              )
            ),
            st.section(
              cls := "player-database__results",
              attr("aria-labelledby") := "player-results-title"
            )(
              div(cls := "player-database__section-heading")(
                div(
                  h2(id := "player-results-title")("Results by side"),
                  p("Every percentage is from the selected player’s perspective.")
                )
              ),
              div(cls := "player-database__outcomes")(
                playerOutcome("red", "Playing as Red", "The player made the first move"),
                playerOutcome("black", "Playing as Black", "The player responded to Red")
              )
            ),
            div(cls := "player-database__insights")(
              st.section(attr("aria-labelledby") := "player-opponents-title")(
                div(cls := "player-database__section-heading")(
                  div(
                    h2(id := "player-opponents-title")("Frequent opponents"),
                    p("Most common matchups and results from this player’s perspective.")
                  )
                ),
                div(id := "player-opponents", cls := "player-database__ranked-list")
              ),
              st.section(attr("aria-labelledby") := "player-openings-title")(
                div(cls := "player-database__section-heading")(
                  div(
                    h2(id := "player-openings-title")("Recorded openings"),
                    p("Most frequent source-supplied opening classifications.")
                  )
                ),
                div(id := "player-openings", cls := "player-database__ranked-list")
              )
            ),
            st.section(
              cls := "player-database__timeline",
              attr("aria-labelledby") := "player-timeline-title"
            )(
              div(cls := "player-database__section-heading player-database__timeline-heading")(
                div(
                  h2(id := "player-timeline-title")("Game timeline"),
                  p(id := "player-timeline-summary")("Loading dated games…")
                ),
                label(attr("for") := "player-timeline-unit")(
                  span("Time unit"),
                  select(id := "player-timeline-unit")(
                    option(value := "month")("Month"),
                    option(value := "year", selected := true)("Year"),
                    option(value := "decade")("Decade")
                  )
                )
              ),
              div(
                id := "player-timeline-chart",
                cls := "player-database__timeline-chart",
                role := "img",
                attr("aria-label") := "Timeline of this player’s recorded games"
              ),
              p(id := "player-timeline-empty", attr("hidden") := true)(
                "No precisely dated games are available."
              )
            ),
            st.section(
              cls := "player-database__repertoire",
              attr("aria-labelledby") := "player-repertoire-title"
            )(
              div(cls := "player-database__section-heading player-database__repertoire-heading")(
                div(
                  h2(id := "player-repertoire-title")("Opening repertoire explorer"),
                  p(id := "player-repertoire-explanation")(
                    "Choose a side, then play moves to explore this player’s games."
                  )
                ),
                div(
                  cls := "player-database__side-picker",
                  role := "group",
                  attr("aria-label") := "Player side"
                )(
                  button(
                    id := "player-side-red",
                    cls := "active",
                    tpe := "button",
                    attr("aria-pressed") := "true"
                  )("As Red"),
                  button(
                    id := "player-side-black",
                    tpe := "button",
                    attr("aria-pressed") := "false"
                  )("As Black")
                )
              ),
              div(cls := "player-database__explorer-layout")(
                st.section(cls := "player-database__board main-board xiangqi9x10")(
                  div(id := "player-xiangqi-board", cls := "cg-wrap xiangqi9x10")
                ),
                st.aside(cls := "player-database__explorer-panel")(
                  div(cls := "player-database__move-header")(
                    strong("Move list"),
                    div(
                      button(
                        id := "player-explorer-back",
                        tpe := "button",
                        title := "Previous position",
                        attr("aria-label") := "Previous position"
                      )("←"),
                      button(
                        id := "player-explorer-reset",
                        tpe := "button",
                        title := "Reset position"
                      )("Reset")
                    )
                  ),
                  ol(
                    id := "player-explorer-moves",
                    cls := "player-database__move-list",
                    attr("aria-label") := "Explored move sequence"
                  ),
                  st.section(
                    id := "player-opening-explorer",
                    cls := "explorer-box sub-box",
                    attr("aria-label") := "Player opening explorer"
                  ),
                  button(
                    id := "player-opening-explorer-toggle",
                    tpe := "button",
                    attr("hidden") := true,
                    attr("aria-pressed") := "false"
                  )("Opening explorer")
                )
              )
            ),
            st.section(
              cls := "player-database__games",
              attr("aria-labelledby") := "player-games-title"
            )(
              div(cls := "player-database__section-heading player-database__games-heading")(
                div(
                  h2(id := "player-games-title")("Games"),
                  p(id := "player-games-summary")("Loading games…")
                ),
                div(cls := "player-database__sources", attr("aria-label") := "Game sources")(
                  playerCatalogSource("m", "m", "Masters"),
                  playerCatalogSource("online", "n,t,k,o,b,u,w", "DPXQ Online"),
                  playerCatalogSource("gd", "gd", "GDChess / 01xq"),
                  playerCatalogSource("xqd", "xqd", "XQDao"),
                  playerCatalogSource("ec", "ec", "Elephantchess.io")
                )
              ),
              div(cls := "games-database__table-wrap")(
                table(cls := "slist games-database__table player-database__table")(
                  thead(
                    tr(
                      th(button(tpe := "button", attr("data-player-sort") := "source")("Source")),
                      th(button(tpe := "button", attr("data-player-sort") := "date")("Date")),
                      th(button(tpe := "button", attr("data-player-sort") := "red")("Red Player")),
                      th(button(tpe := "button", attr("data-player-sort") := "black")("Black Player")),
                      th(button(tpe := "button", attr("data-player-sort") := "result")("Result")),
                      th(button(tpe := "button", attr("data-player-sort") := "event")("Event")),
                      th(cls := "games-database__optional")(
                        button(tpe := "button", attr("data-player-sort") := "round")("Round")
                      ),
                      th(cls := "games-database__optional")(
                        button(tpe := "button", attr("data-player-sort") := "moves")("Moves")
                      )
                    )
                  ),
                  tbody(id := "player-games-rows")
                )
              ),
              st.nav(cls := "games-database__pagination", attr("aria-label") := "Player games pages")(
                button(id := "player-games-previous", cls := "button button-empty", tpe := "button")(
                  "Previous"
                ),
                span(id := "player-games-page")("Page 1"),
                button(id := "player-games-next", cls := "button button-empty", tpe := "button")("Next")
              )
            )
          )
        )
      )

  def databaseEvent(explorerEndpoint: String, event: String)(using
      @annotation.unused ctx: Context
  ) =
    Page(s"$event — Games Database")
      .css("xiangqi")
      .js(
        PageModule(
          "xiangqi.event",
          Json.obj(
            "explorerEndpoint" -> explorerEndpoint,
            "event" -> event
          )
        )
      )
      .graph(
        title = s"$event — Xiangqi event database",
        url = routeUrl(routes.GameCatalog.event(event)),
        description = s"Standings, rounds, games, results, and opening statistics for $event."
      )
      .body(
        main(cls := "player-database event-database box")(
          header(cls := "player-database__header")(
            div(
              a(cls := "player-database__back", href := routes.GameCatalog.index.url)("← Games Database"),
              h1(id := "event-database-name")(event),
              p(id := "event-database-range", cls := "player-database__range")(
                "Loading this event’s database record…"
              )
            ),
            div(
              id := "event-database-status",
              cls := "player-database__status",
              role := "status",
              attr("aria-live") := "polite",
              attr("aria-atomic") := "true"
            )("Loading event statistics…")
          ),
          div(id := "event-database-content", attr("hidden") := true)(
            st.section(cls := "player-database__metrics", attr("aria-label") := "Event summary")(
              st.article(
                span("Games"),
                strong(id := "event-metric-games")("—"),
                small("canonical records")
              ),
              st.article(
                span("Players"),
                strong(id := "event-metric-players")("—"),
                small("distinct competitors")
              ),
              st.article(
                span("Rounds"),
                strong(id := "event-metric-rounds")("—"),
                small("recorded rounds")
              ),
              st.article(
                span("Average length"),
                strong(id := "event-metric-moves")("—"),
                small("plies per game")
              ),
              st.article(
                span("Openings"),
                strong(id := "event-metric-openings")("—"),
                small("recorded classifications")
              )
            ),
            st.section(
              cls := "event-database__filters",
              attr("aria-labelledby") := "event-sources-title"
            )(
              div(
                h2(id := "event-sources-title")("Included sources"),
                p("The event overview, standings, and round cards update together.")
              ),
              div(cls := "player-database__sources", attr("aria-label") := "Event game sources")(
                eventCatalogSource("m", "m", "Masters"),
                eventCatalogSource("am", "am", "Ancient manuals"),
                eventCatalogSource("online", "n,t,k,o,b,u,w", "DPXQ Online"),
                eventCatalogSource("gd", "gd", "GDChess / 01xq"),
                eventCatalogSource("xqd", "xqd", "XQDao"),
                eventCatalogSource("ec", "ec", "Elephantchess.io")
              )
            ),
            div(cls := "event-database__overview")(
              st.section(
                cls := "event-database__standings",
                attr("aria-labelledby") := "event-standings-title"
              )(
                div(cls := "player-database__section-heading")(
                  div(
                    h2(id := "event-standings-title")("Standings"),
                    p("Ranked by 2–1–0 score, then wins. Equal scores and wins share a rank.")
                  )
                ),
                div(cls := "games-database__table-wrap")(
                  table(cls := "slist event-database__standings-table")(
                    thead(
                      tr(
                        th("#"),
                        th("Player"),
                        th("Games"),
                        th("W"),
                        th("D"),
                        th("L"),
                        th("Score")
                      )
                    ),
                    tbody(id := "event-standings-rows")
                  )
                )
              ),
              st.aside(cls := "event-database__insights")(
                st.section(attr("aria-labelledby") := "event-results-title")(
                  div(cls := "player-database__section-heading")(
                    div(
                      h2(id := "event-results-title")("Results"),
                      p("Recorded outcomes by winning side.")
                    )
                  ),
                  div(
                    id := "event-results-bar",
                    cls := "event-database__result-bar",
                    role := "img",
                    attr("aria-label") := "Red wins, draws, and Black wins"
                  )(
                    span(cls := "red"),
                    span(cls := "draws"),
                    span(cls := "black")
                  ),
                  div(id := "event-results-legend", cls := "event-database__result-legend")
                ),
                st.section(attr("aria-labelledby") := "event-openings-title")(
                  div(cls := "player-database__section-heading")(
                    div(
                      h2(id := "event-openings-title")("Recorded openings"),
                      p("Most frequent source-supplied classifications.")
                    )
                  ),
                  div(id := "event-openings", cls := "player-database__ranked-list")
                ),
                st.section(attr("aria-labelledby") := "event-places-title")(
                  div(cls := "player-database__section-heading")(
                    div(
                      h2(id := "event-places-title")("Venues"),
                      p("Locations attached to event records.")
                    )
                  ),
                  div(id := "event-places", cls := "event-database__places")
                )
              )
            ),
            st.section(
              cls := "player-database__repertoire event-database__explorer",
              attr("aria-labelledby") := "event-explorer-title"
            )(
              div(cls := "player-database__section-heading")(
                div(
                  h2(id := "event-explorer-title")("Event opening explorer"),
                  p("Play moves to explore only the games recorded for this event.")
                )
              ),
              div(cls := "player-database__explorer-layout")(
                st.section(cls := "player-database__board main-board xiangqi9x10")(
                  div(id := "event-xiangqi-board", cls := "cg-wrap xiangqi9x10")
                ),
                st.aside(cls := "player-database__explorer-panel")(
                  div(cls := "player-database__move-header")(
                    strong("Move list"),
                    div(
                      button(
                        id := "event-explorer-back",
                        tpe := "button",
                        title := "Previous position",
                        attr("aria-label") := "Previous position"
                      )("←"),
                      button(
                        id := "event-explorer-reset",
                        tpe := "button",
                        title := "Reset position"
                      )("Reset")
                    )
                  ),
                  ol(
                    id := "event-explorer-moves",
                    cls := "player-database__move-list",
                    attr("aria-label") := "Explored move sequence"
                  ),
                  st.section(
                    id := "event-opening-explorer",
                    cls := "explorer-box sub-box",
                    attr("aria-label") := "Event opening explorer"
                  ),
                  button(
                    id := "event-opening-explorer-toggle",
                    tpe := "button",
                    attr("hidden") := true,
                    attr("aria-pressed") := "false"
                  )("Opening explorer")
                )
              )
            ),
            st.section(
              cls := "event-database__rounds",
              attr("aria-labelledby") := "event-rounds-title"
            )(
              div(cls := "player-database__section-heading")(
                div(
                  h2(id := "event-rounds-title")("Rounds"),
                  p(id := "event-rounds-summary")("Loading round-by-round results…")
                )
              ),
              div(id := "event-round-list", cls := "event-database__round-list")
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
          bootstrap
            + ("notationStyle" -> JsString(ctx.pref.xiangqiNotationStyle(ctx.lang).key))
            + ("language" -> JsString(ctx.lang.code))
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
