# Interactive AI move delivery

## Decision

Interactive “Play with the computer” turns are coordinated by the round actor.
Redis Pub/Sub transports work, and the Pikafish process computes a move, but
neither transport nor worker owns gameplay state.

This keeps the correctness boundary beside the authoritative `GameProxy`, where
normal moves, takebacks, resignations, and game completion are already
serialized. It also avoids introducing a durable queue for a request that is
cheap to reconstruct from the current game.

Whole-game analysis continues to use the existing Fishnet HTTP protocol. The
versioned Redis protocol described here is only for interactive AI moves.

## Invariants

1. Only the round actor decides whether an AI move is currently wanted.
2. Every request contains an immutable game snapshot, a semantic turn key, and
   a unique logical request ID. Delivery retries reuse that ID.
3. The turn key covers the game ID, effective AI level, initial FEN, and complete
   coordinate-move history. The history is required for Xiangqi repetition
   semantics; a board FEN alone is insufficient.
4. A result is applicable only if its turn key still describes the authoritative
   game and its request ID belongs to the actor's current pending turn.
5. Delivery is at-least-once. Application is effectively once because applying
   a move changes the authoritative turn key before another result can apply.
6. A Redis lease prevents concurrent duplicate computation only. It is never a
   gameplay lock and never grants permission to apply a move.

The canonical key is SHA-256 over these UTF-8 fields joined with a NUL byte:

```text
lixiangqi-ai-turn-v1
game ID
effective AI level
initial FEN
all coordinate moves joined by one space
```

Scala and Python tests share this contract vector:

```text
gameId:    aikey001
level:     5
initial:   rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1
moves:     <empty>
turnKey:   642cc6d1a03e937016a7bd812d2b964ec0aa573ac0cea610f5230e4a6fe731f5
```

Changing this representation requires a new protocol/key version and matching
changes to both contract tests. Do not reinterpret version 1 in place.

## Lifecycle

```text
authoritative game changes
        |
        v
round actor observes current turn
        |
        +-- human turn / finished game --> clear pending AI turn
        |
        +-- AI turn --> schedule actor-owned think delay
                           |
                           v
                   publish immutable V2 request
                           |
                           +-- no response --> watchdog republishes same request ID
                           |
                           v
                  worker verifies turn key
                           |
                           v
                 acquire owned Redis lease
                           |
                           v
                    compute and respond
                           |
                           v
            round actor validates key + request ID
                           |
                           +-- stale --> ignore
                           |
                           +-- current --> use normal move pipeline
```

The coordinator currently retries after 5 seconds, then 10 seconds, then every
20 seconds. A worker-ready signal may request an immediate retry; duplicate
ready signals inside one second are coalesced. The existing round tick is the
watchdog, so recovery does not depend on a new scheduler or service.

Takeback completion explicitly asks the actor to reconcile. A different
position replaces the pending turn and its request ID. Returning later
to an identical history may recreate the same semantic turn key, but it starts
a fresh request ID, so a response from the abandoned occurrence is rejected.

## Failure behavior

| Failure                                 | Recovery                                                                                  | Safety property                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| Request published with no subscriber    | Round watchdog republishes                                                                | Current game is re-read before every attempt |
| Result lost                             | Round watchdog republishes; worker replays its cached result                              | Duplicate results cannot both apply          |
| Redis/worker restarts                   | Worker-ready signal triggers reconciliation; watchdog remains a fallback                  | Actor remains the authority                  |
| Engine rejects or fails work            | V2 failure response advances the retry path                                               | Failure cannot mutate the game               |
| Worker dies while computing             | Owned lease expires after 120 seconds                                                     | Lease expiry cannot authorize a move         |
| Takeback or another move races a result | Key or attempt validation rejects it                                                      | Stale work is inert                          |
| Duplicate work reaches multiple workers | Redis lease limits computation; completed result is cached by request ID for five minutes | Actor validation still protects correctness  |
| Round actor is reconstructed            | Initial game observation recreates pending state                                          | No transport state must be recovered         |

Malformed protocol messages are logged without logging the full position
payload. Worker errors log game ID and request ID for correlation. Expected
stale results are counted and only debug-logged by the server.

## Protocol V2

Requests are published on `fishnet-move-v2-out`; results and worker-ready events
are published on `fishnet-move-v2-in`. Messages are JSON with `version: 2` and a
`type` discriminator.

A move request contains `requestId`, `gameId`, `turnKey`, `level`, `position`
(`variant`, `initialFen`, and a move array), and an optional clock. A result
echoes all three identity fields and contains either `type: move` plus `move`, or
`type: failure` plus a bounded failure code.

`AiMoveProtocol` is the Scala codec. `MoveWork.parse_v2` is the worker boundary.
Keep parsing strict and keep engine-specific coordinate conversion behind the
worker's UCI adapter.

## Deployment and rollback

Deploy in this order:

1. Deploy the worker that subscribes to both legacy and V2 request channels and
   can publish both result formats.
2. Confirm worker-ready events and a V2 smoke game in the target environment.
3. Deploy the application, which publishes V2 work and temporarily reads both
   result formats.
4. After the compatibility window, remove the legacy paths in a separate,
   reviewable change.

This order gives a clean rollback: the upgraded worker continues to serve an old
application. Do not deploy the V2-publishing application before at least one V2
worker is subscribed. Simultaneous dual-publishing is intentionally avoided
because it doubles engine work and makes the legacy result race the V2 result.

## Monitoring

The application emits these counters:

- `fishnet.aiMove.request`: every V2 attempt;
- `fishnet.aiMove.retry`: attempts after the first for one observed turn;
- `fishnet.aiMove.staleResult`: rejected V2 results;
- `fishnet.aiMove.failure`: correlated worker failures; and
- the existing `fishnet.move` counter for successfully applied moves.

Alerting should look for AI games with a current AI turn whose age exceeds the
normal engine budget, supported by a rise in retries or failures. A stale-result
increase after takebacks is diagnostic, not automatically an outage.

## Review checklist

- Does every new trigger send a reconciliation message to the round actor rather
  than publishing work directly?
- Is the authoritative game re-read before scheduling, publishing, accepting,
  and applying?
- Are takeback, game end, actor reconstruction, worker restart, duplicate
  delivery, and malformed-message tests still present?
- Did a protocol/key change receive a new version and matching Scala/Python
  contract tests?
- Are legacy compatibility changes isolated from the normal gameplay pipeline?
- Are logs bounded and free of full FEN/move payloads?
- Are retry timings longer than normal work but shorter than a user-visible
  stall, and are leases longer than the worker's hard computation deadline?

## Non-goals

- Redis is not made a source of truth.
- No durable queue or distributed workflow engine is introduced.
- Takeback rules, Xiangqi legality, clock stepping, normal move persistence,
  analysis Fishnet, and client socket contracts are not reimplemented here.
