# Xiangqi games database

The authoritative local catalog is `data/local/xiangqi-games.sqlite3`. Database
files and downloaded source pages are intentionally excluded from Git.

Run the bounded weekly update:

```powershell
.\scripts\windows\Update-GamesDatabase.ps1
```

Or from cron on a Unix deployment:

```cron
17 4 * * 1 /srv/lixiangqi/cron/update-games-database.sh >> /srv/lixiangqi/logs/games-database-update.log 2>&1
```

Source-specific commands:

```powershell
python -m tools.games_database.dpxq_scraper update-new
python -m tools.games_database.dpxq_ancient_manuals
python -m tools.games_database.gdchess_scraper update-new-events
python -m tools.games_database.xqdao_scraper update-new-events
python -m tools.games_database.elephantchess_scraper
```

DPXQ master IDs increase over time: ID 1 is old and the largest ID on listing
page 1 is the current frontier. The updater requests only the range above the
largest committed master witness.

DPXQ's ancient manuals live under `棋谱下载 → 象棋谱大全 → 古谱全局`.
The ancient-manual updater audits all 13 published directories (424 records),
keeps each original DhtmlXQ page, and imports complete move trees plus Chinese
commentary. It also stores each manual's chapter hierarchy and game order for
the Learn → Ancient Manuals page. For a bounded verification run, use
`--manual meihuaquan --limit-per-manual 2`; the default sync is resumable.

GDChess/01xq and XQDao place recent event collections first. Their incremental
commands refresh bounded newest-event windows, parse their game IDs, and
download only IDs not already present. XQDao defaults to the newest ten events;
increase `--lookback-events` when an older event received late additions.

Elephantchess.io publishes a cumulative anonymized PvP ZIP from its datasets
page. The updater discovers the newest Xiangqi archive, extracts its CSV files,
and imports only source game IDs not already committed. Player names are
displayed as `Anonymous`; moves are converted from the site's zero-based ranks
and replayed through Pikafish before insertion.

Annotated and branching sources use the same canonical `games` rows as plain
records. Pass a lossless notation string, `AnnotationLayer` values, and sparse
`SourceTreeNode` branch records to `upsert_source_record`; source commentary,
translations, engine series, and variations remain attached to their exact
source witness. Manual examples should use `record_kind = 'manual_example'`
and `statistical_eligible = 0` unless they document a historical played game.
