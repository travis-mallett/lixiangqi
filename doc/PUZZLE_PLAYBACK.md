# Puzzle playback

Published puzzles carry `playback` with an explicit `objective` (`mate` or
`tactic`), the complete list of accepted `solutions` (UCI lines after the setup
move), and a positive solver-perspective `startingCp` for tactics. The first
solution is the existing primary line. The primary `line` remains the public
solve identity; it is not a second source of playback decisions. The legacy
public JSON `solution` is derived from the first playback solution for existing
API consumers.

Publication projects this small contract from retained complete verifier traces.
The verifier's `advantage` objective becomes `tactic`. Full search evidence stays
in Studio. Common prefixes are indexed once in the browser. Every saved attacker
alternative is accepted, including nested alternatives, without an engine search.
The selected saved defense is played. Solution replaces the displayed tree with only the saved solution branches,
rooted at the puzzle position. It excludes source-game history and attempted
player lines. The notation viewer and its responsive styles are shared with
Xiangqi analysis; active attempts include source-game history, keep one attempted line,
and discard abandoned retries. Hints follow the current branch; on an
unsaved line they use the engine's recommendation for that position.

Pikafish evaluates deviations in the user's browser with one `go infinite` search
and a four-second budget, with half the
device's reported logical CPUs (rounded down, minimum one). Native server rules
still validate moves and mating continuations. The puzzle page prepares Pikafish
before enabling any move input, including saved solution moves. Preparation loads
the content-hashed engine assets and network, applies thread/hash settings, and
awaits the native readiness handshake. It performs no search. The message panel
uses the same progress component as analysis: download percentage and transferred
MB, followed by an indeterminate animated startup phase. Cached network bytes are
reused across application restarts.

Preparation fails after 60 seconds without download progress or startup completion;
a progressing download can take longer. Failed downloads are aborted, invalid
networks are evicted, and Retry is available before puzzle completion. The separate
60-second move watchdog starts only after preparation. A timed-out native search
is disposed before retrying, so it cannot block a subsequent request.

A mating deviation is a best move if its positive mate distance is no greater
than the local reference's additional solver moves after the submitted move.
A longer verified continuation can be played within the original fixed allowance.
Accepted engine continuations are retained for the attempt without deleting saved
alternatives. Restart rebuilds the attempt tree; completed deviation decisions and validated
continuations remain cached for this puzzle, keyed by the exact move history.
Playing the same line on a retry or restart reuses the same score, defense,
and outcome. Loading another puzzle clears this cache. Cancelled, errored, and
inconclusive evaluations are not cached. Only solver moves
count; allowances remain three times the primary solver length, except two-move
mates allow four. Winning on the final allowed move succeeds.

The timer starts from the engine's first reported search time, excluding startup
and queued UCI commands. At four seconds, an adverse or missing score extends the
same running search by two seconds, regardless of depth. No `stop`, new `position`,
or second `go` is sent at that boundary. There is no depth ceiling. Acceptable
results stop at four seconds. Extended searches normally stop at six. If the
six-second result would still fail the player and remains below depth 20, the
same search continues until a completed depth-20 result, an acceptable score,
or fifteen seconds of total search time, whichever comes first. Missing or
unusable evidence retains the six-second limit. At the deadline, the deepest
usable result is adjudicated even below depth 20; depth is a search target, not
a requirement for recording the outcome. A newly found mating line must pass
native-rules validation before acceptance. Native terminal results are immediate.
This bounds search time without imposing unpredictable depth-only waits. Engine
startup/downloads, native-rules requests, and animations add wall-clock time;
saved solutions and cached decisions need no fresh engine search.

Deviation searches replace previous feedback with **Evaluating Move** and live
completed depth, initially Depth 1. The shared animated engine bar uses the native
search time reported with completed depths to measure their actual work. A fixed
exponential depth curve is misleading in simple endgames, which can exceed depth
100 within the four-second budget. The initial budget occupies 75% of the line,
the two-second confirmation another 10%, and the longer extension another 10%.
Reserving space prevents backward jumps when a search extends; the animated line
never claims completion while work remains. This display changes neither deadlines
nor acceptance criteria. Saved solutions and cached decisions skip the indicator;
cancellation discards stale updates.

Failure distinguishes lost forced mate, excessive mate distance, exhausted
allowance, lost tactical advantage, native draw, and native loss. Positive mate
distances beyond the allowance include moves needed and moves remaining. Missing,
bounded, illegal, incomplete, or unavailable analysis remains unscored. All
messages use the translation system.

Every automatic defense waits until at least 750 ms after the solver move and
until its animation can finish. Current animation settings are 0/120/250/500 ms;
the delay grows if a future animation exceeds this minimum. For an evaluated
failure, the defense plays first, its animation finishes, and then failure is
announced and scored. The board stays on the defense. Retry slides the defender move back, waits 250 ms, then slides the player move
back and removes the abandoned branch. Reverse notation navigation uses the same
Chessground slide option as analysis and game viewers; forward navigation keeps
the standard animation. Restart clears the attempt. Neither action
changes an already submitted result. Terminal positions have no fabricated reply. The compact action bar provides
Retry, Restart, Hint, Solution, and Next during an unfinished puzzle; Hint
is available after engine preparation, and Retry is available after a loading or
move-request error. Failure or success unlocks the review actions and replaces Hint
with Analyze. The action bar uses a muted failure background while showing a
failure. Analyze transfers the displayed tree including game history. Retry and
Restart preserve the completed result and unlocked actions; Next starts a new,
locked puzzle. Solution still displays only published solution branches.

## Deployment and recovery

The adjacent `lixiangqi-beta-deployment/push-local-live.ps1` exports an identity-
checked playback projection from the local authored catalog (override with
`-PuzzleCatalog`) and packages it in the explorer image. It does not package the
catalog database or replace server inventory. Deployment runs
`tools/data_migration/20260920_puzzle_playback.py` with writers stopped, after the
publication metadata migration and before services resume.

The migration checks every live puzzle against its exported identity, retains
complete originals in `__lixiangqi_puzzle_playback_v1_backup`, persists plans in
`__lixiangqi_puzzle_playback_v1_plans`, and only then adds playback. It verifies that
every other field is unchanged. It preserves ratings, votes, play counts, source
snapshots, and unknown fields; accounts and puzzle rounds are not written.
Interrupted applications resume from retained plans. Rollback finishes a prepared
additive migration before old writers resume. Completed migrations never replay
old plans over later publications. Backups remain available for recovery.

Historical published mates without retained verifier evidence migrate their
existing accepted primary line, using their explicit mate category; the export
reports these IDs as `primaryOnly`. It does not invent alternate moves. Missing
objective or tactical baseline evidence blocks affected live records before any
mutation. Newly verified puzzles always publish their full retained branches.
Studio adopts additive server metadata while preserving local moderation drafts.
