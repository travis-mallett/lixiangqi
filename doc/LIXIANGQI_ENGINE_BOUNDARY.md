# LiXiangQi rules and engine boundary

LiXiangQi is an independent Xiangqi application. The inherited application
infrastructure remains useful, but former-upstream game behavior is not its
rules authority.

`modules/xiangqi` owns native legal moves, position transitions, notation and
versioned adjudication. A rules position is the initial FEN, complete ancestor
move sequence and ruleset. History-dependent adjudication must not start again
from a selected node's FEN. See [Tiantian rules](TIANTIAN_RULES.md).

Native coordinates cover `a1` through `i10`. Study trees, APIs, persistence and
browser components retain literal coordinates. Only the explicit Pikafish UCI
boundary converts to the engine's zero-based rank convention. The shared
`chessgroundx` board consumes native ten-rank coordinates directly.

Pikafish supplies search and evaluation, in the browser or through the native
worker. It is not the application's adjudication authority. Requests retain the
initial position and branch moves, restrict root search to native legal moves,
and validate complete returned principal variations before application. Invalid
lines produce an explicit failure; no valid-prefix truncation is substituted.
Pikafish's search policy and the application's Tiantian policy are distinct:
search quality and availability in policy-divergent continuations need further
end-to-end verification.

Study server analysis and private external engines use the native worker in
`external/pikafish_worker/analysis.py`. Their queues, authentication, bounded
resources and source-history checks are documented in
[native study data](native-study-data.md) and
[operational recovery](xiangqi-study-operations.md).

Browser analysis avoids server search CPU. Server analysis requires an actual
worker; an unconfigured worker is not a passed verification. The
[conversion ledger](xiangqi-study-conversion.md) records remaining checks.
