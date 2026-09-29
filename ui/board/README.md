# LiXiangQi Board

`@lixiangqi/board` is the canonical public board module. `BoardView` renders a visible position, handles pointer/keyboard input, draws marks, and owns motion and feedback. It does not calculate legal moves, run engines, store preferences, manage game clocks, navigate move trees, or contact the server.

```text
Live game / study / puzzle / lessons / editor / preview / shared viewer
             | position + presentation + interaction + services
             v
                   @lixiangqi/board
             | private rectangular rendering backend
             v
                  DOM / CSS / board assets
```

## Ownership

- `types.ts`: visible positions, geometry, input intents, presentation, transitions, marks, and host services.
- `definitions.ts`: supported board definitions and named presentation defaults (`interactive`, `replay`, `editor`, `thumbnail`, `preview`).
- `position.ts`: visible FEN and coordinate codecs; relocation of already validated recorded moves. These helpers never determine move legality.
- `board.ts`: the only application-facing renderer API. Callers never access backend mutable state.
- `feedback.ts` and `audio.ts`: per-board effects, duplicate acknowledgment suppression, and opt-in standalone sound.
- `catalog.json`: the single board/piece/effect/sound asset catalog. The backend preference catalog is generated from this same source. Existing preference keys remain stable.
- `css/`: geometry, faces, shadows, coordinates, and motion styling.
- `patches/`: the maintained private ChessgroundX dependency patch. Its existing rendering, hit-testing, drag, resize, and animation machinery is retained; its library name is an implementation detail, not our public API. Preserve dependency licensing and attribution.

The asset build rejects missing faces, backs, supported geometry, or effect files. It also rejects direct application imports of the private backend. Add a supported definition only when every accepted theme covers it. Theme changes automatically reach all consumers and public embeds through the normal asset build and deployment.

`lib/board` is the website adapter: it resolves account preferences, supplies site assets/audio, and owns page resize integration. `@lixiangqi/viewer` owns replay controls, variations, comments, and local theme selection. `@lixiangqi/explorer` owns the shared opening database controller and view. These responsibilities stay outside the renderer.

## Variants

A variant's rules own legality, history, setup restrictions, and hidden information. The board receives only the visible projection. A face-down piece contains a back identifier and optional visible participant, never its hidden role.

The implemented backend supports two participants on rectangular boards, 1–16 files/ranks, with cell or intersection placement. Standard Xiangqi is the only registered production definition. Tests exercise a smaller cell board and conceal/reveal transitions. Jieqi, mini Xiangqi, and Banqi still need their rules, assets, and product integration before registration. Their geometry can use this backend.

A genuinely different topology, such as a three-player board, needs a geometry/rendering backend behind this same public module. It must not be forced into a rectangular two-player model or implemented as a page-specific board. New topology support is future work, not an enabled game in this change.

## Contracts

- Locations use game coordinates (`a10`), participants use domain names (`red`, `black`). Private backend coordinates never leak into new consumers. Existing persisted study paths and wire annotations are converted at their boundary and are not rewritten.
- A controller supplies authoritative destinations. Board gestures produce move intents. The controller decides whether to send, submit, reject, or confirm them.
- `display(position, transition)` separates position synchronization from announcements. Initial loads, jumps, corrections, and edits are quiet. Adjacent playback may animate; backward playback slides without replaying capture/check effects. Stable move IDs suppress duplicate server acknowledgment feedback.
- `thumbnail` and `preview` are quiet. `preview` also disables motion; `editor` enables explicit placement through edit mode. Reduced-motion preference overrides travel/effects.
- An editor uses `place`/`dragPiece`; spare-piece trays remain feature UI. A preview uses the same board with display interaction. A live game supplies premove destinations from the Xiangqi rules adapter.
- Mount once, update through the public API, then call `destroy`. Bind feature timers, observers, and subscriptions through `onDestroy`. Snabbdom callers store the actual owned instance on each vnode.

## Migrated surfaces

Native analysis, study (including study multiboards), live play/spectating/TV, puzzles and playback, board editor, Learn boards, notation trainer, ancient manuals, special-rules examples, engine-line previews, mini boards, CAPTCHA, and the existing elbow-horse proof page use this API. Replay embeds, stored forum/study PGN embeds, and tutor examples use the shared viewer.

Deferred Western-chess infrastructure for unadvertised Storm/Racer and analogous legacy consumers remains intact per repository policy. It is not a supported Xiangqi rendering path and does not use the private ChessgroundX dependency directly. No stored games, studies, users, preferences, or wiki revisions are migrated or deleted.

## Study storage limitation found during verification

The study board now uses the canonical renderer, but its pre-existing server tree is not a complete native Xiangqi model. `study/AnaMove`, `GameToRoot`, stored tree moves, and shapes still depend on Scala chess `Square`/`Uci` (64 squares); `StudyPgnImport` still parses chess movetext. Converting rank ten to `:` at the UI boundary does not make that server codec accept it. Ordinary moves within the first eight files/ranks work, but native Xiangqi imports and moves outside that range remain unsupported. This also limits what existing study exports can contain; generic embeds and wiki examples use the separate canonical native notation API and support the full board.

The required follow-up is a native study tree and move/shape codec, followed by migration of study persistence, paths, socket messages, import/export, and consumers. Back up original study documents before that migration, validate every existing FEN and branch, fail on unsupported data, and integrate the migration into deployment. Do not extend chess's 64-square type with dummy squares, silently discard branches, or add a parallel runtime fallback. This renderer refactor does not perform that data-model migration.

## Verification

Run the repository formatting/lint/asset/test checks. Focused regressions live in `ui/board/tests`, `ui/viewer/tests`, and the consuming feature tests. Public routes are `/embed/xiangqi`, existing analysis/game embed routes, and existing study embeds; study visibility checks remain server-side.
