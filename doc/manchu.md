# Manchu+

LiXiangQi's `manchu` variant implements PyChess **Manchu+R**, displayed as
**Manchu+**. Red retains its complete ordinary army. Black starts with a Banner
on a10, a chariot on i10, the general, two advisors, two elephants and five
soldiers. Black has no horses or cannons.

The Banner combines chariot movement/capture, cannon capture over exactly one
screen, and the horse's leg-blocked move. All ordinary palace, river, flying
general and check constraints apply. Stalemate loses. Threefold repetition draws
unless exactly one player perpetually checks, in which case that player loses.
One hundred plies without a capture draw; soldier moves do not reset that count.
Manchu does not use Tiantian chasing adjudication.

Sources:

- [PyChess Manchu rules](https://www.pychess.org/variants/manchu)
- [PyChess variant configuration](https://github.com/pychess/pychess-variants/blob/0878c944238c3596d27ff7ba826463b5e1a58a3f/client/variants.ts)
- The distributed Fairy-Stockfish source in `public/fairy-stockfish-engine/source.zip`:
  `src/variant.cpp` (`manchu_variant`, `xiangqi_variant_base`) and `src/piece.cpp`
  (`BANNER`, Betza `RcpRnN`). Its binary and source provenance are in `SOURCE.txt`.

## Ownership and persistence

`GameVariant.Manchu` and `ManchuRules` own variant selection and the starting
position. The shared Xiangqi move generator implements the Banner, and
`adjudication.RepetitionRules` owns the Fairy-Stockfish repetition/no-capture
policy shared with Mini Xiangqi. The authoritative server validates all moves.

Native FEN uses `m` in the third field to preserve variant identity after the
Banner is captured. External initial FEN containing a Banner is normalized on
import. The UCI adapters remove that marker and select `UCI_Variant=manchu`.
Fairy-Stockfish uses one-based ranks (`a1` through `i10`); Pikafish uses different
coordinates and must not process Manchu positions.

Browser analysis and the computer worker share one Fairy-Stockfish distribution
with Mini Xiangqi. Computer levels 1–10 use the existing variant node budgets.
The independent Manchu rank track uses the same settlement rules as the other
variant ladders. Its rated pool is 10+0 with the standard variant move ceilings.

## Release

Deploy the backend, browser assets, Python worker and updated websocket patch
together. `push-local-live.ps1` packages the shared Fairy-Stockfish directory and
worker adapter; `push_transport.py` applies
`tools/data_migration/20261104_manchu_indexes.js` before restarting the service.
This migration adds and verifies leaderboard/history indexes; it does not alter
user documents. Both scripts live in the sibling beta-deployment directory.

Mobile variants remain a separately deferred project. Standard-only mobile
consumers must filter unsupported variant descriptors before parsing games,
pools or account feeds. Their reconciliation queues record this release.

## Regression coverage

`ManchuTest` checks the exact starting armies, Banner movement/screens/horse
legs, checks, repetition, notation and captured-Banner persistence. Its opening
perft reference is 48 moves at depth 1 and 45,712 nodes at depth 3, measured
against the distributed Fairy-Stockfish engine. Setup, rank, pool, BSON, browser
analysis, websocket presence and Python worker tests cover the surrounding
integration, including both colors and every computer level.

Local verification on Windows (November 4, 2026):

- Frontend formatting, type-aware lint, style lint and production asset build passed;
  the complete frontend suite passed all 699 tests. Windows runs the `ui/test`
  symlink's target directly: `node ui/.test/runner.mjs`.
- Translation generation and stale-file checks passed. All 6,223 XML files
  validated; translation lint reported zero errors and 1,390 existing warnings.
- `scalafmtCheckAll` and `test;stage` passed with MongoDB 8.2 integration tests
  enabled. The bundled Java 21 needed the repository's Windows selector workaround.
  Limiting SBT concurrency avoided unrelated integration-test timeouts.
- All 31 websocket tests and 76 deployment tests passed. The additive migration
  passed two runs against isolated fixtures with unchanged source documents.
- Variant/AI worker checks passed 54 tests. Bot calibration passed 34 tests;
  supplementary Jieqi/analysis checks passed 20 with one optional native-engine
  test skipped. The 11 asset-publication/install tests and Pikafish WASM smoke test
  passed. Both piece generators reproduced all 137 existing outputs exactly.
- Chromium verified the menu and analysis board at 1440, 900 and 390 pixels,
  live browser-engine evaluation, a computer game including a Banner horse move
  and reply, and a friend invitation accepted by a second browser. Backend history
  retained the Manchu variant and moves.
- Main mobile: existing variant/feed guards passed 14 tests; its 97 Standard board
  asset snapshots still match. Kids: new variant/feed guards, formatting and static
  analysis passed; 216 tests passed with one existing skip. Neither app enables
  Manchu gameplay.

Linux CI, Android/iOS builds and production deployment were not performed for this
change. No commit or push was prepared. Test services are stopped after verification.
