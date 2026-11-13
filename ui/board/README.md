# LiXiangQi Board

`@lixiangqi/board` is the canonical public board module. `BoardView` renders a visible position, handles pointer/keyboard input, draws marks, and owns motion and feedback. It does not calculate legal moves, run engines, store preferences, manage game clocks, navigate move trees, or contact the server.

```text
Live game / study / puzzle / lessons / editor / preview / shared viewer
             | position + presentation + interaction + services
             v
                   @lixiangqi/board
             | shared motion, indicators and feedback
             | rectangular / graph geometry adapters
             v
                  DOM / CSS / board assets
```

## Ownership

- `types.ts`: visible positions, geometry, input intents, presentation, transitions, marks, and host services.
- `definitions.ts`: supported board definitions and named presentation defaults (`interactive`, `replay`, `editor`, `thumbnail`, `preview`).
- `position.ts`: visible FEN and coordinate codecs; relocation of already validated recorded moves. These helpers never determine move legality.
- `board.ts`: the only application-facing renderer API. Callers never access backend mutable state.
- `motion/`: the canonical lift, carry, landing, backward slide, Jieqi turnover, shadows, and move indicators. `MotionHost` supplies screen coordinates and piece reconciliation; it contains no board rules or rectangular coordinate assumptions. Both renderers use this implementation, including the paper theme's animated connector.
- `feedback.ts` and `audio.ts`: per-board effects, duplicate acknowledgment suppression, and opt-in standalone sound.
- `catalog.json`: the single board/piece/effect/sound asset catalog. The backend preference catalog is generated from this same source. Existing preference keys remain stable.
- `css/`: geometry, faces, shadows, coordinates, and motion styling.
- `patches/`: the maintained private ChessgroundX dependency patch. It retains rendering, hit-testing, drag, resize, and move planning, and delegates layered presentation to the board package through lifecycle hooks. It does not contain a second copy of the motion sequence or last-move indicators. Preserve dependency licensing and attribution.

The asset build rejects missing faces, backs, supported geometry, or effect files. It also rejects direct application imports of the private backend. Add a supported definition only when every accepted theme covers it. Theme changes automatically reach all consumers and public embeds through the normal asset build and deployment.

Resting faces and contact shadows share the board's compositor surface. Do not reserve
GPU layers per idle piece or shadow; multi-board pages otherwise accumulate hundreds
of independently rasterized layers. Active WAAPI effects retain compositor acceleration
and share an explicit document-timeline start time with their shadow companions.
Contact shadows stay below all faces to preserve overlap and board-edge clipping.
Check halos belong to the piece's face stack, including lift, travel and drag; they
never paint at a fixed square beneath a moving general. Cleanup moves the halo back
to the resting piece and reconciliation removes it from captured or reused nodes.
`tests/board-compositing.spec.ts` verifies rapid playback/scrolling in real browsers
and bounds idle Chromium layer growth. `BOARD_RENDER_CSS` can select a saved build
for a like-for-like CSS layer-count comparison.

`lib/board` is the website adapter: it resolves account preferences, supplies site assets/audio, and owns page resize integration. `@lixiangqi/viewer` owns replay controls, variations, comments, and the embeddable replay presentation. `@lixiangqi/explorer` owns the shared opening database controller and view. These responsibilities stay outside the renderer.

## Board and piece artwork requirements

All standard Xiangqi themes use one renderer geometry from `standardXiangqi.geometry.frame`.
Measurements below are SVG units from the top-left of the canvas; grid lines are
measured at their stroke center. A centered SVG viewBox is also valid.

| Property | Required value |
| --- | ---: |
| Board canvas | 900 × 1000 |
| Left and right grid margins | 58 each |
| Top and bottom grid margins | 59 each |
| Grid spacing on both axes | 98 |
| First and last file | x = 58 and 842 |
| First and last rank | y = 59 and 941 |
| Piece canvas | 100 × 100, `viewBox="0 0 100 100"` |
| Piece body center | (50, 50) |
| Piece body diameter, including outline | 90 |
| Piece render scale | 1 |

Intersection `(column, row)` is `(58 + 98 × column, 59 + 98 × row)`, where
column is 0…8 and row is 0…9. The river is the interval between rows 4 and 5.
The renderer's cell rectangle is `(9, 10, 882, 980)` inside the artwork.

Piece bodies occupy `(5, 5)…(95, 95)` in their asset. Mark the body geometry
with `data-piece-body="true"` so the asset tests can measure its outline.
Decorative ink filters may soften the outline within the transparent padding.
Provide all seven roles in both colors and a concealed back using the same
dimensions. Cast shadows are separate shared assets; do not bake them into faces.
All pieces render with an 88.2-unit body diameter on the reference board.

`pieceGeometry` in `layout.ts` owns the shared piece scale. Faces, lifted faces,
shadows, halos, and destination markers follow it. Themes may choose marker
colors and styles, but have no board geometry or piece-size overrides.
Static image exports use the same geometry and size as the live board.

Wood, paper, tournament, and Wudang SVG artwork follow this specification.

## Variants

A variant's rules own legality, history, setup restrictions, and hidden information. The board receives only the visible projection. A face-down piece contains a back identifier and optional visible participant, never its hidden role.

The rectangular backend supports two participants on boards of 1–16 files/ranks, with cell or intersection placement. Standard Xiangqi and Jieqi share the 9×10 definition. Mini Xiangqi uses its own 7×7 definition: a 700×700 canvas, 56-unit margins, and 98-unit spacing, placing the first and last intersections at 56 and 644 on both axes.

Each mounted board selects `---board-image-<geometry.id>` from the theme catalog through its local `--board-image` property. The definition also supplies the coordinate sprite. Hosts provide all geometry-specific theme variables so changing themes preserves each board's geometry. Website frames reserve space using the mounted board's local aspect ratio; previews must not inherit the main board's ratio.

Three Kingdoms uses the graph backend with 135 explicit intersections and three seat rotations. `renderer/graphPieces.ts` owns piece identity, orientation and screen geometry; `renderer/rectangularMotion.ts` adapts Chessground's keys and move plans to the same motion owner. Click targets stay at board intersections while separate piece elements travel. Resizing, changing perspective, correcting a position and destroying a board cancel the shared animation lifecycle.

Three Kingdoms live and analysis playback use adjacent forward/backward transitions. Jumps and branch changes remain quiet; backward playback restores captures without replaying capture/check effects. Non-move events such as resignation do not replay the preceding move. The existing deployment installs the locked dependency patch and builds all board consumers, so no migration or additional deployment step is required.

## Contracts

- Locations use game coordinates (`a10`), participants use domain names (`red`, `black`). Private backend coordinates never leak into new consumers. Existing persisted study paths and wire annotations are converted at their boundary and are not rewritten.
- A controller supplies authoritative destinations. Board gestures produce move intents. The controller decides whether to send, submit, reject, or confirm them.
- `display(position, transition)` separates position synchronization from announcements. Initial loads, jumps, corrections, and edits are quiet. Adjacent playback may animate; backward playback slides without replaying capture/check effects. Stable move IDs suppress duplicate server acknowledgment feedback.
- `thumbnail` and `preview` are quiet. `preview` also disables motion; `editor` enables explicit placement through edit mode. Reduced-motion preference overrides travel/effects.
- An editor uses `place`/`dragPiece`; spare-piece trays remain feature UI. A preview uses the same board with display interaction. A live game supplies premove destinations from the Xiangqi rules adapter.
- Mount once, update through the public API, then call `destroy`. Bind feature timers, observers, and subscriptions through `onDestroy`. Snabbdom callers store the actual owned instance on each vnode.

### Feedback image lifecycle

`feedback.ts` owns announcements and placement; `feedbackImage.ts` owns animated-image
loading and disposal for both rectangular and graph boards. Share compressed WebP bytes
per document, but create a new blob URL for every presentation. URL fragments do not
reliably restart cached animated-image decoders: a completed transparent frame can be
reused even while the correct sound plays. Each playback releases its image source,
handlers, timer and blob URL on completion, interruption or destruction. Loading does
not consume its visible duration. Failed loads are retryable and stalled loads are bounded.

The browser regression uses a real cacheable HTTP server, because Playwright request
routing disables the HTTP cache and concealed this defect. It checks painted pixels
through repeated capture/check/mate sequences on two boards, as well as independent
playback URLs and a single asset fetch. Run `pnpm exec playwright test tests/board-feedback.spec.ts`
after building assets. Unit tests cover cancellation, slow loading, errors and resource cleanup.
Existing CSP permits blob images and asset-origin fetches. Standalone consumers serving
assets from another origin must allow CORS for those assets. The normal asset build and
deployment include this module; no migration or deployment-tool change is required.

## Migrated surfaces

Native analysis, study (including study multiboards), live play/spectating/TV, puzzles and playback, board editor, Learn boards, notation trainer, ancient manuals, special-rules examples, engine-line previews, mini boards, CAPTCHA, and the existing elbow-horse proof page use this API. Replay embeds, stored forum/study PGN embeds, and tutor examples use the shared viewer.

Deferred Western-chess infrastructure for unadvertised Storm/Racer and analogous legacy consumers remains intact per repository policy. It is not a supported Xiangqi rendering path and does not use the private ChessgroundX dependency directly. No stored games, studies, users, preferences, or wiki revisions are migrated or deleted.

## Study storage limitation found during verification

The study board now uses the canonical renderer, but its pre-existing server tree is not a complete native Xiangqi model. `study/AnaMove`, `GameToRoot`, stored tree moves, and shapes still depend on Scala chess `Square`/`Uci` (64 squares); `StudyPgnImport` still parses chess movetext. Converting rank ten to `:` at the UI boundary does not make that server codec accept it. Ordinary moves within the first eight files/ranks work, but native Xiangqi imports and moves outside that range remain unsupported. This also limits what existing study exports can contain; generic embeds and wiki examples use the separate canonical native notation API and support the full board.

The required follow-up is a native study tree and move/shape codec, followed by migration of study persistence, paths, socket messages, import/export, and consumers. Back up original study documents before that migration, validate every existing FEN and branch, fail on unsupported data, and integrate the migration into deployment. Do not extend chess's 64-square type with dummy squares, silently discard branches, or add a parallel runtime fallback. This renderer refactor does not perform that data-model migration.

## Verification

### Jieqi reveal timing

The concealed-piece motion uses the measured cadence of reference recording
`244597A0-AE0A-4329-B6AB-738C7C5B41BA.MP4` (30 fps). At normal animation speed:

| Phase | Duration | End from move start |
| --- | ---: | ---: |
| Lift and travel | 100 ms | 100 ms |
| Landing | 33⅓ ms | 133⅓ ms |
| Settled hold | 66⅔ ms | 200 ms |
| Turnover | 133⅓ ms | 333⅓ ms |

In zero-based reference frames, the first reveal travels at 69–71, settles at 72,
holds through 74, and turns at 75–78. The same sequence occurs at 150–159 and
180–189. Capture timestamps have small jitter; a 30 fps recording cannot establish
subframe source timing. These are the nominal timings matching its repeated poses,
not a claim of submillisecond measurement from the video.

The shared motion owner retains the existing selection, capture, interruption,
and cleanup behavior. Concealed travel/landing and turnover use one browser timeline
so phase completion callbacks do not accumulate extra frame delays. An authoritative
reveal consumes the elapsed hold; if it arrives late, the full turnover starts immediately.
Animation speed preferences scale this schedule, and disabled/reduced motion still wins.
Already visible pieces keep the normal Xiangqi timing.

Run the repository formatting/lint/asset/test checks. Focused regressions live in `ui/board/tests`, `ui/viewer/tests`, and the consuming feature tests. Public routes are `/embed/xiangqi`, existing analysis/game embed routes, and existing study embeds; study visibility checks remain server-side.
