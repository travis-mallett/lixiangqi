# Lixiangqi

Lixiangqi is an independent native Xiangqi fork originally derived from
[Lichess](https://github.com/lichess-org/lila). The web shell, accounts,
navigation, accessibility, internationalization, game orchestration, ratings,
puzzles, and analysis boundaries retain that foundation, while their game
semantics are Standard Xiangqi. Development proceeds independently; Lila
upstream commits are not imported.

Standard Xiangqi (WXF rules) is the only selectable variant today. Lila's structural variant machinery remains in place so future Xiangqi variants can use the native setup, lobby, challenge, rating, and game abstractions without reconstructing them.

## Windows preview

On the prepared development machine, double-click **`Start Lixiangqi.cmd`**. It starts MongoDB, Redis, the read-only Xiangqi opening explorer, and the web application, waits for readiness, and opens:

```text
http://localhost:9663/
```

Runtime data is kept in `data/local` and process logs in `logs`. See [scripts/windows/README.md](scripts/windows/README.md) for command-line options and troubleshooting.

## Development and tests

The native Xiangqi rules boundary is in `modules/xiangqi`. Coordinate moves are authoritative; positions, legality, WXF, and game results are derived in process. Pikafish runs at Lila's browser-ceval and Fishnet boundaries, and remains an independent comparison oracle for offline tests.
The repository-wide native feature audit and mandatory conversion order are in
[doc/NATIVE_PORT_AUDIT.md](doc/NATIVE_PORT_AUDIT.md).

Useful focused checks:

```powershell
.venv\Scripts\python.exe -m unittest discover tools\xiangqi_data\tests
node ui\.test\runner.mjs xiangqi
& .tools\jdk-21\jdk-21.0.11+10\bin\java.exe '-Dsbt.server.autostart=false' -jar .tools\sbt\sbt-launch-2.0.3.jar 'xiangqi/test'
```

## Current scope

Normal moves, setup, challenges, tournaments, Swiss, simuls, imports, analysis requests, and native puzzles use the in-process Xiangqi domain. Browser evaluation uses Pikafish Web; server analysis and AI use Lila's Fishnet work boundary. The read-only opening explorer is independently deployable under `external/xiangqi_explorer`; canonical catalog ingestion and weekly source updates live under `tools/games_database`; puzzle mining and comparison-oracle code remains under `tools/xiangqi_data`.

With the local site running, `python -m tools.xiangqi_data.validate_native_rules`
differentially checks native legality, check state, and position transitions
against the pinned Pikafish executable. This is an offline release check, not a
runtime dependency.

## License and attribution

Lila and PyChess Variants are free software distributed under the GNU Affero General Public License. See [COPYING.md](COPYING.md), the upstream repositories, and [doc/PYCHESS_PORT.md](doc/PYCHESS_PORT.md) for attribution and pinned revisions.
