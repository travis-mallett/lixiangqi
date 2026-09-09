# Homepage presence

Homepage occupancy comes from the lila-ws connection registry. A connected
visitor is one authenticated account, deduplicated across its tabs, or one
anonymous browser identity shared by its tabs. A visitor contributes at most
once to each activity category, while different tabs may place that visitor in
multiple categories.

The Redis `lobby-in` `counters` message carries a complete snapshot as JSON:
`{"members": number, "rounds": number, "poolCounts": {"label": number}}`.
Lila replaces its immutable snapshot atomically for server-rendered data. The
lobby WebSocket receives the same snapshot through a separate `counters`
message pushed about every two seconds. The legacy `n` message remains the
response to an actual lobby ping and contains only players and games.

Activity labels are `ai`, `friend`, `puzzle`, `lobby`, or a configured homepage
pool ID. A page may also declare `activityGroup: "other"`; this contributes an
identity once to the `other` union across lobby and homepage pool activities.
Puzzle, AI, and friend activities cannot join that union.
Round player JSON supplies a label only for an ongoing playable player view;
spectators and finished games are excluded. Puzzle, lobby, and matchmaking
pages report their current activity through the shared client presence path.
Disconnects remove the connection from the registry; lila-ws publishes the
result on its normal approximately two-second presence update cadence. A clean
close appears on the next sample. A silently dropped network connection can
remain visible until the WebSocket broom detects it, usually after roughly
30–37 seconds.

The `rounds` value remains the native games-in-play metric. API-flagged
WebSocket clients and HTTP API streams do not contribute to visitor presence,
while their raw operational metrics remain available separately.
