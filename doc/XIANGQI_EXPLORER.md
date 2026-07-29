# Xiangqi games database and opening explorer

## Architecture

Lixiangqi uses one authoritative local SQLite catalog:

```text
data/local/xiangqi-games.sqlite3
```

The file is local deployment data and is excluded from Git. Source HTML caches
are also local and provide the lossless archival input for repeatable parsing.

The database separates five concerns:

1. `games` contains one resolved canonical record plus complete UCI and display
   notation arrays for its main line.
2. `game_sources` retains every DPXQ, GDChess/01xq, XQDao, PGN, or manual
   witness linked to that record.
3. `annotation_sets`, `annotations`, and `annotation_series` preserve attributed
   prose, translations, editorial notes, and dense engine analysis.
4. `source_tree_nodes` stores only source-specific branches; witnesses without
   variations use the canonical main line without duplicating every node.
5. `game_positions` is the opening-statistics projection. It stores only the
   first occurrence of a position in each canonical game.

`works` and `editions` provide bibliographic ownership for ancient manuals.
Manual examples, composed positions, and analysis trees use the same record
model but have `statistical_eligible = 0`.

## Identity and provenance

Canonical played-game identity is based on:

- rules variant and initial position;
- normalized Red and Black names;
- result;
- validated UCI main line.

Dates, event spelling, source identifiers, comments, engine evaluations, clocks,
and analysis variations are excluded. Consequently the same game can have many
source witnesses without being counted more than once.

Every source witness retains its external ID, collection, URL, residual source
metadata, parser version, checksum fields, matching method, and confidence.
Recognized `commentN` values become node-anchored annotations. `comment0`
anchors to the root; valid positive numbers anchor to the corresponding
mainline ply. The original source key is always retained. GDChess/01xq AI arrays
become a structured annotation series instead of millions of individual rows.

## Opening explorer

The analysis-board explorer reads the canonical position projection and offers:

- DPXQ Masters;
- all statistically eligible games;
- all DPXQ collections;
- GDChess/01xq;
- XQDao;
- player filtering.

Source selection uses `EXISTS` membership queries against `game_sources`, so a
game appearing in several selected databases is still counted once. Variations,
manual examples, and repeated occurrences of the same position in one game do
not affect empirical win percentages.

The games database page uses the same catalog. It displays all configured source
collections and opens canonical game IDs on the analysis board. The full game
response includes every witness and annotation layer. A witness can optionally
store its original recursive notation so PGN variations are reconstructed by
the native Xiangqi notation importer.

## Initial migration

The one-time migration from the former source-owned databases is:

```powershell
.\.venv\Scripts\python.exe -m tools.games_database.migrate
```

It streams the three old databases, recalculates source-independent identity,
stores canonical positions once, extracts structured annotations, builds
indexes, performs foreign-key and repetition checks, and atomically installs
`xiangqi-games.sqlite3`.

The old database files may be removed only after the migration and integrity
checks complete successfully. The migration does not delete source HTML.

## Incremental updates

Run all sources:

```powershell
.\scripts\windows\Update-GamesDatabase.ps1
```

Source-specific entry points:

```powershell
.\.venv\Scripts\python.exe -m tools.games_database.dpxq_scraper update-new
.\.venv\Scripts\python.exe -m tools.games_database.gdchess_scraper update-new-events
.\.venv\Scripts\python.exe -m tools.games_database.xqdao_scraper update-new-events
```

### DPXQ

Master IDs increase over time. ID 1 is at the old end; the greatest ID on
master listing page 1 is the current frontier. `update-new` compares that
frontier to the largest committed master witness and requests only the missing
range. Downloads and commits are resumable.

### GDChess/01xq

The catalog is event-based and newest-first. The updater refreshes the newest
two catalog pages by default, refreshes those event listings, and downloads only
uncommitted game IDs. Use `--lookback-pages` for unusually late additions to an
older event.

### XQDao

XQDao is also event-based and newest-first. Its updater scans the newest ten
event collections by default (with index-page and event-count bounds), and
skips committed or quarantined game IDs before game-page retrieval. A strict
desktop browser user agent is used because the site redirects modified or
generic clients to a different mobile layout.

## Weekly scheduling

Example cron entry:

```cron
17 4 * * 1 /srv/lixiangqi/cron/update-games-database.sh >> /srv/lixiangqi/logs/games-database-update.log 2>&1
```

The orchestrator stops on the first source error unless `--continue-on-error`
is requested. A fully successful run records its timestamp and result in
`sync_state`.

## Environment overrides

`LIXIANGQI_GAMES_DB` overrides the authoritative database path.
`LIXIANGQI_EXPLORER_DB` remains a compatibility alias for tests and older
deployments. Former source-specific database overrides are deliberately not
honored: every reader and writer uses the one authoritative catalog. The
migration reads the three explicit legacy paths directly.

## Verification

Relevant tests:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tools\xiangqi_data\tests
pnpm test
pnpm exec tsc -p ui\xiangqi\tsconfig.json --noEmit
```

Production checks should additionally include:

- `PRAGMA integrity_check`;
- `PRAGMA foreign_key_check`;
- source and annotation counts;
- canonical hashes are unique;
- `(game_id, position_key)` is unique;
- explorer totals agree with distinct canonical game IDs;
- analysis-board loading of a source-annotated game and a recursive-variation
  notation record.
