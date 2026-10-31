# Native play integration smoke

`smoke.mjs` exercises the deployed HTTP, lobby websocket and NDJSON game
contracts with two real clients. It covers the rated 15-minute pool, casual
5/10/20 rooms, custom clocks, correspondence/unlimited seeks, guest and account
friend challenges, ownership isolation, moves, reconnect, takebacks, draws,
extra time, resignation and rematches.

Use disposable local services, never the normal preview database or a deployed
site. The script intentionally fixes HTTP to `127.0.0.1:19663`, sockets to
`127.0.0.1:19664` and the seed to database `mobile_play_smoke` on port `27319`.
The fixture tokens are public test data and grant no access outside this fixture.

1. Start MongoDB on port `27319` with an empty task-owned data directory and a
   replica set; initialize the replica set. Start Redis on port `16391` with an
   empty task-owned data directory.
2. Build/stage the application and the patched socket gateway. Configure the
   application to use MongoDB
   `mongodb://127.0.0.1:27319/mobile_play_smoke`, Redis
   `redis://127.0.0.1:16391`, `http.port=19663`,
   `net.domain="127.0.0.1:19663"`, and
   `net.socket.domains=["127.0.0.1:19664"]`. Set `net.ratelimit=false` only in
   this isolated test configuration: repeated fixture creation otherwise shares
   the production five-setups-per-minute IP limit. Stream concurrency limits
   remain enabled. Disable traffic collection and mock mail in this configuration.
3. Configure the gateway with `http.port=19664`, the same MongoDB and Redis
   URIs, and `csrf.origin="http://127.0.0.1:19663"`. Start both staged services
   and wait for `/api/mobile/play` to return HTTP 200.
4. Seed and run from the repository root after `pnpm install`:

   ```powershell
   mongosh 'mongodb://127.0.0.1:27319/mobile_play_smoke' --file tools/mobile_play/seed.js
   $env:MOBILE_PLAY_SMOKE = '1'
   node tools/mobile_play/smoke.mjs
   Remove-Item Env:MOBILE_PLAY_SMOKE
   ```

The script uses Node 24 and the websocket dependency already installed by the
repository's jsdom tests. It closes its own clients even on failure. Run this
suite sequentially with the Flutter opt-in repository integration test, since
both guest clients share loopback IP concurrency limits. Stop only the local
services started for the test afterward. Preserve logs under the ignored
`logs/` directory when diagnosing a failure.
