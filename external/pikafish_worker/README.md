# Pikafish move worker

`ai.py` implements Lixiangqi's Redis move-work boundary with a minimal,
persistent Pikafish UCI client. It does not expose application APIs, implement
Xiangqi rules, or import the offline calibration tool.

```powershell
python -m external.pikafish_worker.ai
```

Run one or more workers beside the application with access to the same Redis
instance and a local Pikafish executable. Set `LIXIANGQI_REDIS_HOST`,
`LIXIANGQI_REDIS_PORT`, and optionally `LIXIANGQI_PIKAFISH` when their defaults
do not apply.

The worker reconnects with bounded backoff after Redis or network outages and
re-announces itself after subscribing, which causes active computer turns to be
submitted again. An owned, expiring Redis lease deduplicates concurrent work.
Success atomically replaces that lease with a short-lived result cache so a
lost response can be replayed without another engine search; failure releases
only the lease owned by that request. The round actor remains responsible for
retrying and deciding whether a result still belongs to the current turn.

Interactive move-delivery invariants, protocol V2, deployment order, and
operations are documented in
[`doc/AI_MOVE_DELIVERY.md`](../../doc/AI_MOVE_DELIVERY.md).

The nine strength profiles use one thread and fixed nodes. Levels 1-4 sample
between adjacent Pikafish ranks at 149 nodes. Levels 5-9 use `MultiPV=1` and
play `bestmove` at increasing node budgets. Rank sampling is reproducibly seeded
from game state. There are no score-temperature, tail-mixture, behavior,
independent-lapse, or opening-book controls.

The production profile table and maintenance contract are documented in
[`doc/PLAY_WITH_COMPUTER.md`](../../doc/PLAY_WITH_COMPUTER.md). Calibration
methodology lives in
[`tools/bot_levels_optimization/METHODOLOGY.md`](../../tools/bot_levels_optimization/METHODOLOGY.md).

Whole-game server analysis remains on the standard `/fishnet/*` HTTP work
protocol. A deployed Pikafish-capable Fishnet worker acquires those jobs through
that separate path.
