# Xiangqi variation-tree contract

Lixiangqi represents analysis, review, study, and entered-game move history as an
ordered tree. A flat move array is only a projection of one selected path; it is
not a storage model.

## Upstream behavior used

The implementation follows the invariants in Lichess's generic analysis tree
(`ui/lib/src/tree/tree.ts`, `ui/analyse/src/ctrl.ts`, and the inline/column tree
views):

- a synthetic root owns the initial position;
- child zero is the preferred continuation and therefore the main line;
- every other child is an alternative from the exact same parent position;
- stable path IDs, rather than ply numbers, identify positions;
- replaying an existing child selects it instead of duplicating it;
- playing a different move from an earlier node appends a variation;
- promotion reorders siblings without changing their stable IDs;
- deletion removes a subtree and moves an affected cursor to its parent;
- a main-line move can be forced into a parenthesized variation without
  inventing a replacement main line.

The indented presentation also follows the useful part of Chess.com's review
UI: alternatives are visually subordinate to their branch point, not flattened
into an ambiguous two-column move list.

The Xiangqi implementation is deliberately independent of `chessops` and
scalachess. `ui/xiangqi/src/tree.ts` is the Xiangqi browser model, while
`modules/xiangqi` remains authoritative for legality, FEN transitions, and WXF
notation.

## Position and path semantics

A tree consists of:

- an initial Xiangqi FEN and synthetic root state;
- ordered move nodes containing stable ID, UCI move, WXF notation, resulting
  rules state, children, and optional evaluation/UI metadata;
- an active path from the root to the selected position.

Every rules or engine request projects the active path to its UCI move list, or
uses the selected node's authoritative FEN. No request concatenates moves from
different branches.

A FEN describes one position and cannot itself encode variations. Loading a FEN
therefore creates a new tree rooted at that position. Recursive movetext is the
notation entry point for trees.

## Movetext interchange

The import/export format uses PGN-style recursive annotation variations with
Xiangqi tags and either WXF or UCI move tokens:

```text
[Variant "Xiangqi"]
[FEN "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"]
[SetUp "1"]

1. P9+1 P1+1 (1... H2+3 2. P7+1) 2. P7+1 *
```

The native rules domain parses parentheses, comments, move numbers, results,
and NAG tokens. It resolves every WXF token against native legal moves. Illegal,
unknown, ambiguous, overly large,
or deeply nested input fails closed. Duplicate lines merge rather than creating
duplicate siblings.

## Evaluation behavior

There are two distinct analysis modes:

1. Normal live Pikafish analysis evaluates the currently selected node. Moving
   to any variation automatically evaluates that branch position and stores the
   result on that node.
2. **Analyse line** evaluates every position from the root through the selected
   continuation. At the root it follows child zero, so the default is the main
   line. When a variation is selected it follows that variation instead.

This mirrors the useful Lichess split: a requested whole-game/server analysis is
main-line-oriented, while interactive engine analysis follows whatever position
the user navigates to. Cached evaluations belong to node paths, never raw ply
numbers, so equal plies in different branches cannot overwrite one another.

## Persistence and database boundary

Browser drafts use the versioned `StoredMoveTree` JSON contract and are keyed by
initial FEN. The document stores stable IDs and child ordering, so reloads retain
variation identity, promotion order, cursor path, collapsed state, and cached
evaluations. The importer has explicit node/depth/size limits, and local draft
loading rejects malformed or incompatible documents.

For a native Mongo game/study domain, persist the structural fields as the
source of truth:

- schema version and initial FEN;
- node ID, parent/ordered children, UCI move, and `forceVariation`;
- user-authored annotations and optional engine result metadata.

WXF, legal destinations, check/end flags, and resulting FEN are derived data.
They may be materialized for read performance, but writes and imports must be
replayed through the native Xiangqi rules boundary before acceptance. Main-line-only
game indexes should continue to project child zero, while studies/reviews load
the complete tree. Server analysis jobs default to that child-zero projection;
an explicit path selects a variation job.

The repository does not yet contain the native persistent Xiangqi game domain
described in `LIXIANGQI_ENGINE_BOUNDARY.md`. Until that domain replaces the
remaining 8×8 game storage, the analysis page provides versioned local draft
persistence and complete notation round trips. The tree contract above is the
required value type for that future game, review, study, editor, and database
work; those surfaces must consume it rather than introducing new flat move
arrays.

## Interaction contract

- Click a move to select its exact path.
- Left/right navigate parent/preferred child; Home/End navigate root/end of the
  selected line; Shift+left/right switch siblings.
- Right-click or press and hold a move to promote, make main line, convert to a
  variation, collapse alternatives, or delete the subtree.
- Engine PV and explorer buttons use the same move-add operation as board input,
  so choosing a suggestion at an earlier node creates a branch automatically.
- Every structural mutation updates movetext and the versioned local draft.
