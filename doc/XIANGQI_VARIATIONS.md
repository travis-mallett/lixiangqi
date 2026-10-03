# Native Xiangqi variation trees

The canonical backend tree is `modules/tree`; the canonical browser tree is
`ui/lib/src/tree`. Study, analysis, lessons, practice, explorer insertion and
broadcasts consume these models. There is no separate Xiangqi page tree or
second legacy study model.

An ordered branch is identified by its literal native coordinate move, such as
`i10i9`. Display notation never identifies a node. Paths join native moves with
`/`. The first child not marked as a forced variation is the mainline; all
sibling order is retained. A selected path projects exactly one ancestor move
sequence for rules and engines.

The root carries the initial position and ruleset. Each node stores annotations
and derived native rule state. A FEN alone cannot preserve adjudication history.
Transport sends one complete `tree` object; Mongo retains its efficient flat,
ordered-node encoding and targeted updates. See
[native study data](native-study-data.md) for codecs, limits and concurrency.

`XiangqiNotation` owns the notation grammar and native replay. Its explicit
format boundary accepts coordinates, WXF and Chinese moves, nested variations,
comments, annotations, clocks, results and metadata. Invalid input is rejected
before study creation or replacement. Structured comment attribution and lesson
metadata use explicit directives in that same format.

Engine and explorer moves enter through the same native move-add operations as
board input. Adding a new move at an earlier position creates a variation;
selecting an existing move does not duplicate it. Promotion changes child order,
not move identity, and deletion removes the selected subtree.

Implementation and verification status are recorded in the
[conversion ledger](xiangqi-study-conversion.md). This architecture description
is not a claim that every inherited interaction has passed live verification.
