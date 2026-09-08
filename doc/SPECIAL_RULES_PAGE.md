# Special Rules learning page

`/learn/special-rules` teaches the current Tiantian policy with compact teaching
scripts and a broader boundary bench. Both are registered in the production-owned
`modules/xiangqi/src/main/SpecialRulesExamples.scala`:

| Stable ID              | Checking pieces        | Accepted checks | Prohibited next check | Accepted plies / attempted ply |
| ---------------------- | ---------------------- | --------------- | --------------------- | ------------------------------ |
| `single-chariot-check` | Chariot                | 6               | 7th                   | 12 / 13                        |
| `two-piece-check`      | Two horses             | 12              | 13th                  | 24 / 25                        |
| `three-piece-check`    | Chariot, horse, cannon | 18              | 19th                  | 36 / 37                        |

The page also displays focused fixtures for sequence restart, checking and
defender captures, terminal checkmate priority, repeated chasing and chase-target
restart, alternating check/chase with one or multiple physical pieces, and
five-fold quiet-position repetition. These scripts include their relevant prior
history so the tested counter or sequence is visible. Their final input may be a
prohibited continuation or an accepted terminal/draw move; the page reports the
actual engine result rather than assuming every fixture ends in rejection.

Each registry entry contains only ID, initial FEN, ruleset, and ordered UCI
inputs, including the final attempted move. Scala rules integration tests and
Learn consume those same compiled values. Expected identities and outcomes are
test assertions; explanatory English/Chinese text belongs to the page. Neither
controls navigation nor supplies actual adjudication. The former singleton and
duplicated one-piece histories have been removed.

The two-horse example distinguishes physical identity from piece type. The
three-piece example includes discovered cannon checks: the checking piece need
not be the piece just moved. All three start in valid endgame positions with
both generals in their palaces and neither general in check. Every accepted
Red move checks and every Black reply legally evades it, without captures.

The read-only example endpoint accepts only a registry ID and a bounded
move index. It starts a real `Xiangqi.Game` with `tiantian-v1` and applies each
scripted input through `XiangqiRules.move(Game, Uci)` and `Game.applyMove`, the
same transition calls used by live `MovePlayer`. It returns the last accepted
state and a separate rejected attempt. No database games, player accounts,
clocks, explorer, engine, or websocket sessions are created.

Every navigation request reconstructs the history from its initial position.
This restores counters, piece identities and forcing facts when rewinding;
FEN alone would not do that. Forward jumps validate every intervening move.
Requests are serialized independently per widget and failures preserve that
widget's last response. Every board, move list, notice, control,
and keyboard handler is scoped to its example root. Bootstrap IDs and endpoints
come from the registry; repeated elements use classes rather than duplicate IDs.
Responses are not cached, including when the user retries a rejected move.

The notation list is descriptive input, separate from accepted game history.
Unrestricted replay generates its immutable labels once per registry entry,
including the attempted move's label;
those unrestricted states never reach the board. If production rules unexpectedly
accept the final move, the board displays that acceptance. An unexpected early
rejection is also displayed at the actual rejected step.

Both live round views and the example use
`ui/lib/src/game/view/adjudication.ts` and its shared stylesheet. Keep future
adjudication notices and presentation behavior in that shared component, not
in a page-specific renderer. Message translations remain in
`ui/lib/src/game/adjudication.ts`. The example uses the existing Xiangqi board,
coordinate conversion, legal-destination mapping and site sound system.

The learning page presents the description and shared adjudication notices.
Raw rules-engine diagnostics remain available from the example endpoint, rather
than an expandable panel in the article.

The article uses shared Learn/About typography. Example playback shares the
Puzzle replay panel and move-scroller styles, with the board publishing its height
to the example root. On desktop, moves and descriptions scroll within that height;
navigation stays below them. On mobile, previous/next arrows flank a single
horizontal move strip immediately below the board, followed by the description.
Examples start at the initial position with scrolling at the beginning. Navigation
and resizing keep the selected move or rejected attempt visible within the list.

Verification covers agreement with live transitions at every accepted ply,
rejection or terminal result, rewind, input bounds, unexpected acceptance, request serialization,
failure/retry and shared notice localization. Browser checks should additionally
exercise next/back, direct move selection, the final attempt, and narrow layouts.

The board histories additionally verify legal moves and physical checker
identities, no premature ending where applicable, counter resets, terminal
priority, and rejection through both legal-move filtering and direct transition
attempts. Pure synthetic sequence tests remain alongside them for compact boundary
and combination coverage. See
[the coverage map](TIANTIAN_RULES.md#coverage-map) for deliberate test scope.

Use a full UI build when introducing this bundle: targeted package builds check
and emit assets but do not publish a new manifest in the current build system.

The verification suite should run the Xiangqi registry/playback tests and the
Tiantian boundary tests, then the focused special-rules UI tests and browser
check. The browser check should cover every rendered fixture's initial state,
final input, rewind behavior, independent widget state, Chinese text, and narrow
layouts. Project-owned services must be stopped with
`scripts/windows/Start-Lixiangqi.ps1 -StopOnly` after verification.

No rules policy, stored data, runtime dependencies, or deployment steps changed.

See [the September 7 fixture audit](TIANTIAN_FIXTURE_AUDIT.md) for all 18 legal histories, counter isolation, rule evidence, and verification.
