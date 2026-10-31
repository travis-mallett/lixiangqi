# Native mobile human play

## Computer play

`POST /api/mobile/play/computer` creates a game using `SetupForm.mobileAi` and
the website's existing `Processor.ai`. Anonymous clients receive a private
12-character player ID; accounts using `mobile:play` receive an 8-character
game ID. The ten main setup difficulties map to engine levels
`1, 9, 98, 187, 276, 364, 453, 542, 631, 720`; other progression levels are rejected
by this endpoint. Standard/from-position, side, ruleset, real-time/correspondence,
increments and optional move limits use the existing website form contract.
Strict FEN and minimum from-position clock validation are retained.

`GET /api/mobile/play/computer/stats` returns registered and optional personal
standard-game counts for only these ten levels. Both endpoints use `no-store`,
accept anonymous or `mobile:play` credentials, and require no new OAuth scope,
migration, native engine, or worker. Deploy the website changes before releasing
the mobile feature. Existing game streams and command endpoints handle moves,
takebacks, draws, resignations and rematches. The mobile app does not expose the
720-level progression map. `push-local-live` already includes these sources.

## Human play rollout

Deploy the application and the canonical `scripts/windows/lila-ws-xiangqi.patch`
together before distributing this mobile release. `push-local-live` already
fingerprints, prepares, builds and packages that patch. No new service, secret or
data migration is needed. Existing mobile sessions must sign in again to obtain
`mobile:play`; browser OAuth requests must include it. Kids tokens keep their
puzzle and Kid-mode permissions.

`GET /api/mobile/play` accepts anonymous requests or a `mobile:play` bearer. It
returns `pools`, `quickPools`, `socketUrl`, optional `socketToken`, `nowPlaying`, `poolCounts`,
and the existing lobby counts. The pools come directly from `PoolList.homepage`:
ranked 15+0 with a 90-second move limit, and casual 5/10/20+0 with a 60-second move
limit. All four use 30 seconds for each player's first three moves.

Connect to `socketUrl?sri=<random session identifier>`. For authenticated
connections send `Authorization: Bearer <socketToken>`. The gateway accepts raw
bearers only for `mobile:play` on the lobby endpoint; its older signed web clients keep their signature
requirements. Never put the bearer in a URL. Guest connections omit that header.
Use the website lobby messages `poolIn`, `poolOut`, `hookIn`, `hookOut`, `join`,
`joinSeek`, `cancel`, and `cancelSeek`; consume its `redirect`, `hooks`, `had`,
`hrm`, `hli`, and `reload_seeks` events. Pool membership needs the website's
periodic renewal and reconnection behavior.

Custom public games use `POST /setup/hook/:sri` with the website's URL-encoded
form and `GET /lobby/seeks`. These remain casual. Correspondence and unlimited
seeks require an account. `DELETE /api/mobile/play/seek/:id` idempotently removes
only the authenticated player's seek. Friend games use
`POST /setup/friend` and the existing challenge show/list/accept/decline/cancel
APIs. Anonymous clients retain the HttpOnly session cookie issued by the lobby
bootstrap and send it only to that origin. Owner polling of the challenge API
keeps a real-time mobile offer alive. Challenge acceptance returns the player's
`fullId` directly; a public challenge link never reveals an anonymous opponent's
game capability. Anonymous clients retain their own challenge IDs securely.

Live games use:

- `GET /api/mobile/game/:id/stream` (NDJSON);
- `POST /api/mobile/game/:id/move/:uci`;
- `POST /api/mobile/game/:id/:command` with `abort`, `resign`, `draw/true`,
  `draw/false`, `draw-claim`, `takeback/true`, `takeback/false`, `rematch/true`,
  `rematch/false`, `moretime`, `claim-victory`, or `claim-draw`.

Authenticated players use the game ID and their bearer. Guests must retain their
12-character full game ID, a capability accepted only for that anonymous human
side. A registered player's full ID never substitutes for account authorization,
and an AI side is never authorized. Treat guest IDs as secrets. Moves go through
the same human round actor and authoritative Xiangqi rules as website moves.
Move POST bodies may include URL-encoded `millis` (0 through 2147483647), measured
from receipt of the authoritative opponent move to submission. Omit it after
initial load or reconnect when no reliable turn baseline exists; validated
premoves use zero. When `millis` is unavailable, clients can send `lag` with a
measured HTTP round-trip duration, using the same integer bounds. `millis`
takes precedence if both are provided. This uses the existing clock lag tracker
and its compensation quota, without granting a fixed time bonus.

The stream begins with `gameFull` and then emits `gameState` plus connection
events. `playerColor` is `red` or `black`. State includes authoritative FEN,
legal coordinate moves, WXF notation, ply, check, both clocks, the move deadline,
offer flags and permitted controls. State delivery is serialized across async
preference reads. The stream closes after game end; reconnecting retrieves
rematch offers and the accepted game ID (full ID for guests). An active stream
checks flags and sends an empty keepalive line every seven seconds. Native
requests and simultaneous streams have separate per-account/IP limits.

Verification includes player capability isolation, OAuth scope boundaries, the
existing round tests, and socket gateway tests. Release verification must also
exercise two native clients through pairing, moves, reconnect, offers, game end,
and rematch with the application and gateway from the same release.
