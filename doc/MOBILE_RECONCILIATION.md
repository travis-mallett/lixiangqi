# Website and mobile reconciliation

The website owns shared game semantics, API contracts, engine release pins and original
board artwork. Each Flutter app owns its navigation, responsive layout and product scope.
Reconciliation means preserving the applicable behavior, not reproducing web screens.

## Products and receipts

| Product          | Checkout                   | Receipt and review queue                                             |
| ---------------- | -------------------------- | -------------------------------------------------------------------- |
| LiXiangQi Mobile | `../lixiangqi-mobile`      | `doc/WEBSITE_RECONCILIATION.md`, `doc/website-reconciliation.json`   |
| Xiangqi Kids     | `../lixiangqi-mobile-kids` | `docs/WEBSITE_RECONCILIATION.md`, `docs/website-reconciliation.json` |

Resolve the actual checkout before writing. Do not create a second kids app because its
product name was abbreviated to `lixiangqi-kids`. The scanner accepts `--mobile PATH`
and `--kids PATH` for other workspace layouts. A missing checkout is an outstanding
review, not evidence that a change is inapplicable. Record unavailable-checkout items here
temporarily with the product, source changes, behavior and completion criteria, then move
them into that app's queue when accessible.

## Routine workflow

1. Read the changed owning modules, callers and each app's actual feature coverage. Run
   `node scripts/mobile-reconciliation.mjs` before work and again before handoff. Include
   the outgoing commit range and uncommitted changes; dates alone are not checkpoints.
2. Classify each change for each app as **ported**, **already covered**, **server inherited**,
   **not applicable**, or **pending decision/implementation**. Record why and the concrete
   consumer. A shared filename is a review hint, not a verdict.
3. Port clear changes to existing features automatically. Read the app's AGENTS.md, use
   its pinned SDK, localization and shared components, and test the affected contracts.
4. For a new variant, major feature, different interaction design, profile graph redesign,
   new permission or significant scope question, ask whether to implement it concurrently.
   Honor decisions already made in the chat. Put a pending item in each affected app's
   queue while waiting; do not stop unrelated authorized work.
5. Validate shared APIs and fixtures, regenerate checked-in assets/pins, run each app's
   checks, build Android for native changes and verify iOS on macOS/Xcode. Name unrun
   checks. Do not equate emulator testing with physical-device or iOS testing.
6. Update the app's receipt only after reviewing every change through the recorded commit.
   Keep intentionally deferred work in `pending`, with a stable ID, reason, user decision,
   impacted features and acceptance criteria in the Markdown queue. Retain past decisions.
   A receipt records a completed review, not necessarily complete implementation.

`node scripts/mobile-reconciliation.mjs --json` produces machine-readable findings.
`--check` exits nonzero for new source changes, missing baselines/checkouts or items marked
`review-required`. Explicit user deferrals remain visible but do not block unrelated work.
The scanner is read-only: it never edits apps, approves changes, or advances checkpoints.

Receipt schema: `version: 1`, `websiteCommit` (full reviewed Git SHA, or null if unknown),
`reviewedWorkingTree` (map of repository-relative source paths to SHA-256 of reviewed
bytes; null means reviewed deletion), `report` (local report path), `pending` (items with
`id`, `state`, `summary`). Only add file hashes after inspecting those exact bytes. Remove
obsolete fingerprints when advancing the commit anchor. Concurrent edits that change
those bytes must appear as new work; never bless someone else's pending work wholesale.

## Applicability guide

| Website change                                            | Main app                                                                   | Kids                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Legal moves, repetition, results, clocks, game actions    | Check existing rules/API consumers; keep server authoritative              | Same for online and bot games                                   |
| Pikafish source, NNUE, analysis protocol                  | Port pin, network, bridge and cache identity together                      | Evaluate local puzzle/hint engine; bots may be server-owned     |
| Bot levels, identities, modes, progress                   | Existing main computer opponents                                           | Existing 26 kids opponents; preserve child-specific progression |
| Board/grid/piece geometry, shared art, sounds/icons       | Regenerate supported assets and align hit targets/overlays                 | Check shared board; preserve original garden/avatar art         |
| Analysis, notation, export, explorer                      | Existing native workspace and catalogue; preserve metadata and user drafts | No analysis board; inspect puzzle/replay import only            |
| Puzzles, solutions, attempts, hints                       | Port behavior; verify history and scoring                                  | Port applicable simplified puzzle behavior                      |
| Account/security/settings/profile contracts               | Verify native forms, auth/scopes and profiles                              | Only implemented account and child-appropriate settings         |
| Profile charts or significant new profile presentation    | Assess native counterpart; ask about substantial redesign                  | Usually inapplicable; do not introduce adult social surfaces    |
| Blog carousel, lobby footer, web CSS/browser focus/embeds | Usually no counterpart; preserve mobile navigation                         | Usually inapplicable                                            |
| New variant or other large feature                        | Ask/log; never silently enable via shared feeds                            | Separate product decision; usually omit                         |
| Operational jobs, migrations, backend-only fixes          | Confirm shared service effect and release dependency                       | Same where consumed; no duplicate client implementation         |

Variant deferral still requires protecting standard-only clients from mixed feed payloads.
Do not render a new variant on a 9×10 board, accept incompatible challenges, or offer its
matchmaking/tournament rules accidentally. Keep future unsupported keys closed by default.

## Asset and engine ownership

From the main app, use `node scripts/snapshot-board-assets.cjs ../lixiangqi` and its
`--check` mode. This snapshots Standard Xiangqi only, including generated board geometry.
Use `node scripts/snapshot-pikafish.cjs ../lixiangqi UPSTREAM_CHECKOUT` and `--check`.
It exports clean objects at `scripts/pikafish/release.json`'s commit, applies documented
mobile sandbox patches and verifies the website's network checksum. Do not copy a
browser-patched engine working tree or update the NNUE without its matching engine.

The 2026-11-05 main-app audit explains the reconstructed October baseline and the
explicitly deferred variant project. Kids has a review queue rather than a claim of parity.

## Unavailable-checkout queue

None. Both checkouts were located when establishing this workflow.
