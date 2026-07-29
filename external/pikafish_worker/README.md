# Pikafish Fishnet worker

`ai.py` implements Lila's existing Redis move-work boundary with a minimal
Pikafish UCI client. It does not expose rules or application APIs, import the
offline tooling package, or participate in ordinary move legality.

```powershell
python -m external.pikafish_worker.ai
```

Run one or more workers beside the application, with access to the same Redis
instance and a local Pikafish executable. The worker reconnects with bounded
backoff after Redis or network outages and re-announces itself on each
connection; that causes Lila to re-submit the active computer turns. Set
`LIXIANGQI_REDIS_HOST` and `LIXIANGQI_REDIS_PORT` when Redis is not local.

Whole-game server analysis uses the standard `/fishnet/*` HTTP work protocol.
A deployed Pikafish-capable Fishnet worker should acquire those jobs exactly as
Stockfish workers do upstream.
