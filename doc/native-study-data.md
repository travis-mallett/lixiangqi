# Native Xiangqi study data and operations

This describes the implemented backend architecture. Verification status and
remaining release requirements are tracked in [the conversion ledger](xiangqi-study-conversion.md).

## Position and tree ownership

`lila.xiangqi.Xiangqi` owns native sides, 90 intersections, coordinate moves,
positions, rule states and outcomes. `XiangqiRules` is the rule interpreter.
A position is `{initialFen, moves, ruleset}`; adjudication always receives the
complete ancestor move sequence. A FEN cache cannot replace that sequence.

`lila.tree.Root`, `Branch` and `Branches` are the sole annotated study tree.
Each branch contains a native `Move(uci, notation, chineseNotation)` and the
resulting native state. The literal coordinate move, such as `i10i9`, identifies
the branch. WXF and Chinese notation are display values. The first child that
is not explicitly forced to be a variation is the mainline. Child order is
otherwise preserved, including when the same move is merged again.

`lila.xiangqi.UciPath` is a sequence of native coordinate moves. Its serialized
form joins moves with `/`; the root is the empty string. Malformed paths fail
validation rather than resolving to a shorter path. The same codec is used by
HTTP, sockets, the gateway, Mongo and browser consumers. HTTP and analysis
messages carry one complete ordered `tree` object. Iterative postorder writing
avoids recursive tree construction and preserves forced siblings in place;
there is no separate mainline-partition format to reconstruct.

Native shapes directly reference native intersections. `XiangqiGlyph` preserves
every numeric NAG from 0 through 255. Known annotations have translated native
names, while unknown numeric annotations keep their identity.

Participant enrichment uses the native player directory's namespaced
`PlayerId`, native title and source provenance. `RedPlayerId` and `BlackPlayerId`
are the interpreted notation keys. Foreign federation identifiers remain
uninterpreted imported metadata; they cannot trigger native identity or rating
lookups. Broadcast chapter indexing stores native `relay.playerIds`.

## Shared browser analysis presentation

Studies and the standalone Xiangqi Analysis page use `AnalysisTreeView` for move
notation, variations, comments and annotations, and `AnalysisSuggestions` for
principal variations, position previews and evaluation display. Engine headers,
settings controls and evaluation meters are constructed by `analysisEngineView`.
These components live in `ui/xiangqi/src`; their styles are shared Sass partials
imported by both asset bundles.

The study bindings in `ui/analyse/src/treeView/treeView.ts` and
`ui/analyse/src/view/xiangqiEngine.ts` supply controller state and callbacks.
Study edits continue through the existing controller and socket operations;
renderers do not mutate collaborative study data directly. Concealed moves,
contributor permissions, analysis visibility and chapter lifecycle remain the
responsibility of those bindings. Engine searches continue through the existing
Pikafish execution infrastructure, with complete branch history.

This presentation change requires rebuilding frontend assets and the application
templates. It introduces no stored-data migration or deployment reset.

## Persistence and concurrent editing

The inherited flat Mongo chapter layout remains. The `root` map contains `_`
for the initial node and raw slash-delimited paths for branches. Every node has
an `o` array containing its ordered native child move IDs. This array is
authoritative: Mongo field insertion order does not change when a targeted
update promotes a branch.

Stored FEN, ply and display notation are validated by native replay when a
chapter is read. Invalid moves, orphaned nodes, malformed order arrays and
inconsistent cached positions are explicit failures. Node and depth limits are
3,000 and 600 respectively. Limits reject work; they do not truncate imported
trees or mark partial analysis complete.

Per-study sequencing, room message versions and contributor permissions remain
the owning concurrency controls. Move insertion updates the affected subtree,
the parent order and preview denormalization. Comments, drawings, clocks,
glyphs and lesson data use targeted field updates. Tree replacement operations
also enter the sequencer. Source annotation merges preserve contributor
comments by semantic author/text identity and merge shapes and glyphs without
duplicating repeated relay updates.

Chapter previews retain a native source position alongside their final FEN so
multiboard evaluation requests carry history. Search indexes chapter names,
descriptions and metadata through the native study repository without loading
all move trees for each edit.

## Notation boundary

`XiangqiNotation` owns lexical scanning, document splitting, recursive
variations, header escaping and move resolution. `XiangqiAnnotations` owns
comments, arrows, circles, centisecond clocks, elapsed times and evaluations.
Each variation is replayed from its exact parent game state. A batch of
chapters is parsed before any chapter is written.

Exports use PGN-family containers with native WXF or Chinese move notation,
native coordinate annotation squares, `Variant "Xiangqi"`, `Ruleset`, `FEN`
and `MoveFormat` headers. Traditional external `White*` participant headers are
normalized once to `Red*` at import. Conflicting aliases are errors. All
internal participant keys and orientation values are Red/Black. Root comments,
nested variations, unknown headers, results including awarded tournament
points, and arbitrary valid NAGs survive full export/import.

Comments use semicolon lines on export, preserving literal braces and newlines.
Each attributed comment uses a `%comment` JSON record containing its text,
identity, and typed author (`user`, `external`, `site`, or `unknown`). The same
typed author appears in tree JSON, so an external author named `lixiangqi`
remains distinct from a site analysis comment. Ordinary external notation
comments receive the chapter's Annotator when no explicit attribution exists.
The explicit `%study` JSON directive carries `forceVariation`, `computer`,
`clockTrust` and `gamebook` (hint/deviation) metadata. Quoted JSON text is escaped
and parsed by the shared annotation boundary. The chapter headers
`ChapterMode`, `ConcealPly`, `ChapterDescription` and `Orientation` preserve
teaching and presentation settings. Full exports include orientation by
default; callers may explicitly request annotation or orientation omission.

`XiangqiClockControl` parses time-control quantities in seconds, independently
of the source website. It supports increments and move-count stages. Elapsed
time reconstruction tracks each participant separately on every branch;
explicit clock annotations take precedence. Image frames carry both clocks
forward and assign a move's clock to the participant who made that move.

## Analysis and worker transport

Stored `Analysis.position` is mandatory. Principal variations and best moves
use native coordinate identities. Study analysis IDs are scoped as
`study:<studyId>:<chapterId>`, avoiding collisions with game IDs. Cache identity
hashes the canonical initial FEN, complete move history and ruleset.

Worker jobs include the initial position, literal moves, ruleset and derived
legal state for every requested position. The budget is one node count per
position. Results identify `engine: {name, version, nnue}` and contain an
indexed evaluation array; absent entries remain partial rather than shifting
later positions. Worker scores enter relative to the side to move and are
stored relative to Red. Every PV is checked against the full native prefix
history before publication.

Complete study results are persisted inside the study sequencer, after exact
source validation. A deleted chapter cannot be recreated by a late worker.
A result for an earlier source cannot replace a later revision, and depth is
monotonic for the same source. Existing contributor variations are merged when
computer lines coincide with them. Chapter deletion cancels associated study
jobs and analysis without touching games that happen to share an ID.

## Deployment and verification

The one-time native study reset and retained game-analysis move migration live
under `tools/data_migration/`. Both preserve recoverable originals. Native
analysis replay is performed by `lila.tree.NativeAnalysisMigration` against
frozen game sources before applying changes. The deployment integration stops
writers, verifies backups, resets only scoped study dependencies, installs
schema/indexes and records completion so reruns cannot erase new studies.

Backend unit tests cover native import/export, BSON validation, history-aware
rules, forced variations, teaching metadata, clocks, glyph identity and analysis
source selection. The optional real Mongo tests use
`LIXIANGQI_ANALYSIS_TEST_URI` and isolate themselves in disposable databases.
They verify targeted child order, sequenced simultaneous annotation edits,
cloning/reopening, analysis races and scoped cancellation. The separate
[HTTP/WebSocket harness](../tools/study_verification/README.md) tests the running
application with ordinary disposable preview accounts. A successful compile or
unit test run does not replace these integration and browser checks.
