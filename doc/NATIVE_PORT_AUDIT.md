# Native Xiangqi port audit

The architectural test is whether a Lila feature naturally operates on
Xiangqi, or whether a second Xiangqi application bypasses it.

## Current boundaries

- `modules/xiangqi` owns Standard Xiangqi positions, coordinate moves, legality,
  WXF derivation, state transitions, and game results in process.
- `modules/round` applies ordinary moves through that domain. It has no Python,
  HTTP, or engine dependency for game play.
- browser evaluation loads Pikafish Web through the shared ceval engine seam;
  server analysis and AI requests use the Fishnet work seam.
- `modules/puzzle` owns puzzle selection, persistence, attempts, votes, ratings,
  themes, and source-game relationships.
- `external/xiangqi_explorer` is a narrow read-only analogue of Lichess's
  independently deployed opening explorer and owns its catalog query model.
- `tools/xiangqi_data` contains offline ingestion, puzzle mining, and a
  Pikafish comparison oracle. Neither Lila nor its runtime workers import it.

## Required invariants

- There is one stored coordinate move line and one authoritative position
  transition path.
- Pikafish never decides whether an ordinary site move is legal.
- Explorer or mining databases cannot become application persistence.
- Standard is the only selectable variant today, but Lila's structural variant
  support remains available for future Xiangqi variants.
- Temporary compatibility is permitted only for real stored data and must have
  an explicit removal path.

## Continuing audit

The canonical analysis, study, relay, NVUI, and tree abstractions should keep
moving toward shared Xiangqi-capable implementations. Search affected code for
parallel feature controllers, `/v1/xiangqi`, `isXiangqi`, and feature-specific
rules implementations. Low-level Xiangqi geometry, notation, and engine
protocol names are legitimate; copied Lila feature stacks are not.
