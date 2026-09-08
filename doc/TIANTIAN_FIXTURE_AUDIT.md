# Tiantian rules fixture audit — September 7, 2026

## Evidence and scope

This audit verifies LiXiangQi's documented `tiantian-v1` policy, native board
legality, and the human bench at `/learn/special-rules`. It does not establish
exact parity with Tencent's current app. The controlling September 5 screenshot
is still absent from the checkout. Public summaries of older Tiantian rules do
not settle terminal exceptions, chase classification, or all counter details.
No rule was changed on the strength of those summaries.

The [Asian Xiangqi Federation's 2017 rules](https://www.asianxiangqi.org/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B/%E6%AF%94%E8%B5%9B%E8%A7%84%E4%BE%8B_2017.pdf),
printed page 15, diagram 4, supply the board geometry for the mutual-check
fixture. The fixture starts after the diagram's opening capture and first
countercheck pair. Its new-game counters start at zero; none of that omitted
history is counted. The source's draw ruling supports the example's geometry
and mutual-check concept, not Tencent's precise six-turn threshold.

The engine already exempts board checkmate/stalemate and captures from
forced-variation filtering. A mating seventh check is therefore allowed under
the current policy. This is now demonstrated by a legal history and a paired
nonmating continuation, rather than inferred from a seeded counter test.

## Fixture standard

- Every displayed example starts a real game from its FEN with zero adjudication
  history. FEN move numbers never imply unseen checks or captures.
- Assert every accepted move is legal and every prefix remains ongoing until
  the intended terminal move. Assert the last allowed and first forbidden turn.
- Inspect classified facts: actual checker/chaser identities, target identity,
  captures, and relevant opponent behavior. The moving piece is not necessarily
  the checking piece.
- Show complete restarted sequences, including the next boundary. A single
  allowed move after a reset is insufficient evidence.
- Reject only board-legal, noncapturing, nonterminal candidates in restriction
  examples. Assert both the permitted-move list and direct move rejection.
- Pair terminal exceptions with a nonterminal prohibited alternative whenever
  practical. Keep combined-rule tests separate from isolated demonstrations.
- Replay and rewind real histories; never treat fabricated snapshots as legal
  game records. Counter-only tests explicitly label synthetic state.

## Canonical human bench

All 18 histories live in `SpecialRulesExamples.scala`. Expected outcomes live
in tests, not in playback inputs or UI adjudication. The registry is deliberately
initialized in one object: splitting mutually dependent eager registries caused
a class-initialization deadlock during parallel testing and was removed.

| ID                                 | Boundary and isolation evidence                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `single-chariot-check`             | Six accepted checks, seventh rejected; one physical chariot, no captures or opponent checks.                                                                                                                                                       |
| `two-piece-check`                  | Twelve aggregate checks from two horses. First horse checks ten times, second twice; the second horse's `H5+3` is the rejected thirteenth. Its personal seventh check cannot explain the result.                                                   |
| `three-piece-check`                | Eighteen checks with three physical checkers, including discovered cannon checks; nineteenth rejected.                                                                                                                                             |
| `single-check-restart`             | Six checks, one quiet move, six new checks, new seventh rejected. The quiet move resets the streak but preserves the cumulative check allowance.                                                                                                   |
| `single-check-mate-exception`      | Cannon e1 gives all seven checks. Horses provide screens. After six checks, ordinary `g7e8` remains prohibited; `g8e9` places a protected screen next to the general and mates without capturing. No second checking identity explains acceptance. |
| `check-capture-restart`            | One earlier check, checking capture at ply 3 resets to zero, six subsequent noncapturing checks accepted, seventh rejected. The capturing check itself is not carried into the new streak.                                                         |
| `defender-capture-restart`         | One earlier check, checked general captures at ply 2; six fresh checks accepted, seventh rejected.                                                                                                                                                 |
| `single-chase`                     | Six chases of the same physical horse, seventh rejected. Revised horse route b6/d7 eliminates the incidental counter-chase in the older route. No checks or captures.                                                                              |
| `chase-restart`                    | Quiet move to f4 breaks the chase; six new chases of the same horse are allowed, seventh rejected.                                                                                                                                                 |
| `alternating-check-chase-single`   | Twelve alternating turns by one chariot; thirteenth rejected. Neither consecutive-check nor consecutive-chase limits can explain it.                                                                                                               |
| `alternating-check-chase-multiple` | Eighteen alternating turns by two attackers; nineteenth rejected.                                                                                                                                                                                  |
| `alternating-check-chase-restart`  | Twelve old turns, quiet break, twelve fresh turns starting with chase, thirteenth rejected. Returning along an already threatened file would not create a new chase; the fixture deliberately changes files.                                       |
| `quiet-repetition`                 | Fourth occurrence remains ongoing; fifth draws at ply 16. No captures, forcing moves, or forcing responses.                                                                                                                                        |
| `natural-move-limit`               | Complete 120-ply quiet history. Coprime five- and seven-turn rook routes keep all position occurrence counts below five. Ply 119 ongoing, 120 draws.                                                                                               |
| `total-move-limit`                 | Complete 400-ply history, with captures at 91/185/279/373. Each resets the natural counter; it is only 27 at the total-limit draw.                                                                                                                 |
| `last-attacker-captured`           | Checked Red general captures the last soldier; material draw after one legal move.                                                                                                                                                                 |
| `mutual-check`                     | Red starts in check with no prior counted history. Sixth pair draws; each side has two physical checking pieces, so its individual twelve-check allowance is not exhausted. No captures.                                                           |
| `mutual-chase`                     | Black starts; sixth pair draws. Each side consistently chases the same opposing physical piece, without checking or capturing.                                                                                                                     |

## Additional automated boundaries

`TiantianSequenceBoundaryTest` isolates both colors, double-check turn counting,
6/12/18 limits and the three-piece cap, introduction/removal of identities across
restarts, chase target intersection (not merely pairwise overlap), target
changes, both alternating phases, same-category and quiet breaks, mutual
asymmetric counts, and the documented checking-priority threshold.

`TiantianCounterBoundaryTest` explicitly seeds counter snapshots for independent
check allowances, both colors' captures, natural/total/coincident limits,
mate/stalemate precedence, all four attacking roles on either side, and capture
of the last attacker. Combined cases prove that an impending draw does not
legalize a forbidden check, while a permitted reply can reach a draw. Individual
fact mutations isolate every exclusion in the quiet-repetition predicate.

`XiangqiMovementBoundaryTest` complements existing perft/notation/threat tests
with horse legs, elephant eyes/river, cannon screens, soldier river/final-rank
movement, palaces, pins, and mate versus stalemate. These use shared board
legality, not a separate movement oracle.

## Limits of the audit

The vendor's precise chase definition and terminal exception still require an
archived current-app source or reproducible app observations. Our tests establish
an explicit implementation contract, not official certification. Exhaustion of
all permitted moves retains its clearly labeled supplied-move-list test; no
naturally occurring forced-variation-loss history is claimed here. Finite tests
cannot prove every possible Xiangqi position correct.

There are no rule-policy, persistence, dependency, migration, or deployment
changes. The repository's deployment guidance was inspected; no new server-side
step is required for compiled example data and Learn presentation.

## Verification

- Full `xiangqi/testOnly *`: 143 passed after fixture validation.
- Full application `compile`: passed. Targeted Scala formatting completed.
- Focused frontend tests (`specialRulesView`, `specialRules`, `adjudication`): 7 passed.
- `node artifacts/check-rules-audit.mjs`: all 18 final outcomes and rewinds passed;
  widget bounds and 9:10 boards checked at 1440, 900, and 390 pixels; Chinese
  mating continuation, unique DOM IDs, and absence of JavaScript errors checked.
- Representative desktop and mobile screenshots inspected. At 390 pixels,
  existing board-piece effects contribute a small document scroll-width excess
  (4 pixels in the settled playback run); widget and text bounds fit. This audit
  does not claim zero visual overflow from the shared piece effects.
- Local project services stopped with `Start-Lixiangqi.ps1 -StopOnly`.
