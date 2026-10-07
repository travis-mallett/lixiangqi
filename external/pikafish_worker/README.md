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

The 720 strength profiles use one thread and fixed nodes. Level 1 retains
149 nodes, MultiPV 16, expected rank 9.5, and the 600 cp candidate-loss limit.
Levels 2–8 fade search work and guarded rank sampling toward level 9's one-node
best move. Levels 9–720 use MultiPV 1 and the shifted inverse-power node curve,
ending at 5,000,000 nodes. Rank sampling remains reproducibly seeded from game
state. See the production policy below for the exact formulae.

All levels share a master opening book before engine selection. On the bot's
own turns 1–10, book probability fades from 100% to 10% in ten-point steps.
When the fade selects the book but no legal book move exists, the worker uses a
shared 5,000,000-node, MultiPV 1 best-move search; when the fade selects the
engine, it uses the level's normal profile. Lookup failures fall back to that
normal profile. Each turn queries the exact position and samples legal
continuations by master-game frequency. Turn 11 onward uses the unchanged
engine profile. The explorer URL defaults to
`http://127.0.0.1:9002`; set `LIXIANGQI_EXPLORER_URL` for a separate host or
container. The `/opening-book` endpoint returns only master games, all
continuations, and no game samples, with a 500 ms worker request timeout.

The production profile table and maintenance contract are documented in
[`doc/PLAY_WITH_COMPUTER.md`](../../doc/PLAY_WITH_COMPUTER.md). Calibration
methodology lives in
[`archived calibration methodology`](../../tools/bot_levels_optimization/archive/tiantian/METHODOLOGY.md).
The replacement [offline self-play calibrator](../../tools/bot_levels_optimization/README.md)
generates experimental intermediate profiles without installing them here.

Whole-game server analysis uses the native `/fishnet/*` HTTP work protocol:

```powershell
python -m external.pikafish_worker.analysis fishnet --endpoint http://localhost:9663
```

Set `LIXIANGQI_FISHNET_KEY` privately in the worker environment. The default is
one thread and 128 MiB hash; `--threads` and `--hash` set explicit local limits.
The application supplies the initial position, complete native coordinate
history, ruleset, per-position legal moves and terminal results. The worker
searches every non-skipped position and returns native coordinate PVs and
side-to-move scores. The server validates every line against that exact branch
history before saving. Partial progress does not mark a chapter complete.
Pikafish's own continuation rules can disagree with a study policy; such a PV
is rejected explicitly, never truncated or relabelled as valid native analysis.

Private external engines use the same persistent UCI bridge:

```powershell
python -m external.pikafish_worker.analysis external --endpoint http://localhost:9663
```

Register the engine using `POST /api/external-engine` with an OAuth token that
has the engine-write scope. The form fields are `name`, `maxThreads`, `maxHash`,
`providerSecret` (16–1024 characters), optional `providerData`, and optional
`officialPikafish`. Keep the provider secret in
`LIXIANGQI_ENGINE_PROVIDER_SECRET`; never place it in public URLs or logs.
Registration returns a separate browser client secret. Engines use the
`xiangqi-v1` protocol; chess variants and promotions are not accepted.

The native application brokers these searches without running an engine itself.
Providers poll `POST /api/external-engine/work/acquire` with `providerSecret`.
Acquired work includes its own short-lived `secret`, complete position history,
native legal moves, search budget, requested resources and provider data.
Providers post `{secret, analysis, done}` to
`/api/external-engine/work/{id}`. Analysis contains `time`, `depth`, `nodes`, and
`pvs` with native `moves` and exactly one of Red-facing `cp` or `mate`.
A failed provider can send `{secret, done:true, error}`. Jobs disappear when the
browser disconnects, replaces its session search, or the bounded timeout expires.
Invalid credentials cannot acquire another provider's work. The broker caps
active jobs, buffers and update frequency; providers cap their actual local
thread/hash use independently of registration limits.

`--once` processes one available job then exits, for operational verification.
The worker always closes the native process and its pipes on exit.
