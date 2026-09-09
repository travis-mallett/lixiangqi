# Xiangqi puzzle playback

`ui/puzzle/src/xiangqiAdjudication.ts` owns the playback decisions and the two
experimental defaults: `maximumAdvantageLoss = 0.5` and
`playerMoveAllowanceMultiplier = 3`. Mating alternatives must supply a complete
winning continuation within a fixed allowance; reported mate distance alone is
not sufficient. Puzzle generation and stored puzzle data are unchanged.

Playback starts with the stored solution as its saved continuation. The complete
played prefix must match that continuation to receive scripted replies and hints.
Following it advances without another engine search. Only an accepted mating
deviation replaces it, with the played prefix followed by the newly validated PV.
Failed moves, engine errors, and stale work cannot replace the saved continuation.
Completing the stored line still succeeds immediately, subject to authoritative
terminal results and the fixed allowance.

The objective and allowance are fixed before solving begins. Puzzles with mate
metadata/themes have a known mating objective and can follow the stored line
without starting Pikafish; only deviations need a search.
Metadata-less puzzles first evaluate the original puzzle position, after the game
setup move, before enabling moves. This preserves engine-based classification:
a positive starting mate score establishes a mating objective, otherwise the
starting positive centipawn advantage establishes a tactical objective. Startup
errors use the existing evaluation-error handling and leave the attempt unscored.
The starting result is cached for the puzzle, including practice retries.

Every browser search uses the fixed settings in `xiangqiPuzzleEngine.ts`: depth
18, one PV, one thread, 16 MiB hash, and a 60-second timeout including startup.
Scores are converted from red's perspective to the solver's perspective. Searches
receive the complete move history from the game root. A mating deviation needs
an exact positive mate score, a nonempty best PV with a legal first reply, and a
continuation whose solver moves fit the remaining allowance. The existing native
`/api/analysis/position` endpoint then replays the complete history and PV once.
Only a legal continuation ending in a solver win qualifies. The native puzzle
rules remain unrestricted Xiangqi, matching normal puzzle move requests.

A missing, illegal, unfinished, losing, drawn, or over-budget continuation fails
the submitted move. A completed search without usable guidance also fails it;
engine crashes and timeouts remain evaluation errors, as do native transport or
service failures. Native rejection of an illegal PV is a failed move. This is
bounded practical engine adjudication, not proof of a shortest or optimal mate.

A tactical objective requires at least half the original positive centipawn
evaluation, or a positive mate score. Finding mate later does not change a tactical
objective. Tactical alternatives retain their existing evaluation and completion
rules, including evaluation errors for unusable scores. If Pikafish cannot establish
a positive starting advantage for an ambiguous puzzle, that remains an evaluation
error rather than a failed move.

## Completion

Preserving the required evaluation permits continuation; it is not completion.
Success means one of:

- completion of the matching stored line;
- an authoritative game result awarding the solver a win;
- for a tactical puzzle, transposition to the stored final board and side to move,
  while still passing the advantage check;
- for a tactical puzzle, realizing at least the stored line's material gain, while
  passing the advantage check and retaining that material throughout the engine's
  reported principal variation. This guards against credit for a hanging capture.

The material test requires a positive gain relative to the starting position.
It uses fixed rook/cannon/horse/advisor/elephant/pawn values of 9/4.5/4/2/2/1 and
does not replace the engine's evaluation with material counting. This is a
conservative equivalence heuristic: a purely positional alternative with no
material gain must transpose to the stored result or win the game. Principal
variations and fixed-depth mate verification are limited by the search horizon;
these defaults should be tested against real puzzles before tuning them.

Let N be `ceil(solution.length / 2)`, counting stored solver moves only. Mating
puzzles allow 3 solver moves for N=1, 4 for N=2, and 3N for N>=3. Tactical puzzles
retain their 3N allowance. The submitted move counts; opponent replies do not.
Neither the initial engine's reported mate distance nor any later evaluation can
resize the budget. Inefficient moves consume the spare allowance.

Winning on the final allowed move succeeds; winning beyond it fails. Authoritative
draws and losses override even a matching saved continuation. Further practice
cannot turn an already submitted loss into a rated win.

## Solver feedback

Engine checks keep the existing feedback visible. A matching continuation receives
“This is the best move” / “Keep going.” An alternative mating move receives the
same feedback if its solver-perspective mate distance and validated winning line
fit within the previous position's remaining mate distance minus one solver move.
This comparison is local to the saved continuation, including after an earlier
detour. Other accepted alternatives receive “Not the most efficient move” /
“But continuation allowed.” Tactical alternatives always use the latter feedback.

Advantage failures say “Advantage Lost” / “Try again”. Move exhaustion ends the
attempt: it offers Retry and View the Solution, with no hint or further solving
moves. Retry clears attempt branches and restores the original position and line,
while preserving the cached objective, recorded result, and pending next puzzle.

Completion reports solver moves on the successful line and the original stored
solution's solver-move count as the efficiency benchmark. Opponent moves and
reverted failed moves do not count. The total stays fixed during review navigation.

## Boundaries and verification

All played moves, including engine replies, still go through the native Xiangqi
rules endpoint with their complete move history. Search runs in the browser;
there is no Fishnet requirement or additional server evaluation load. Puzzle
pages already enforce cross-origin isolation and deployment already packages
the browser Pikafish assets, so no deployment migration or new runtime is needed.

Pending searches, replies, and reverts are invalidated across puzzle changes.
Navigation is held while a move or reply is pending. Leaving the page disposes
the engine, including when its module or network is still loading.

The live Ls8lj bundle inspected on 2026-09-08 still used exact-line matching.
The prior browser search found initial M4 and M2 after
`p5+1 C3=4 h6+4 H8-7 p8=7`. That score alone no longer qualifies the alternative:
the current search must supply a complete winning line. Regression tests cover
that distinction; the puzzle retains a 12-solver-move budget.

Run `pnpm test puzzle pikafish` for the rules, adapter lifecycle, and
controller playback tests, plus the normal frontend lint/build/test checks.
