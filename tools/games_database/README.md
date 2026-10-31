# Xiangqi games database

The authoritative local catalog is `data/local/xiangqi-games.sqlite3`. Database
files and downloaded source pages are intentionally excluded from Git.

The public Games Database reads a transactionally maintained catalog projection
for global totals, source facets, timeline buckets, and trigram-indexed text
search. Verify the projection after moving or restoring a database with:

```powershell
python -m tools.games_database.catalog_index ensure
```

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

## Canonical player registry

`players`, `player_aliases`, `player_sources` and reviewed `game_players` links live
in the same SQLite catalog as games. Mongo owns only accounts and player follows.
Existing player IDs and URLs remain stable. New identities use opaque `player:`
IDs; publisher IDs are mapped through `player_sources`. Untitled players can have
the same photos, biographies and game statistics as titled players.

Pro Players is a query over this registry. Its eligibility and display badge are
projections of sourced, unrevoked IGM/IM/IFM/GM/NM title records. CXA association
master/local master grades remain recorded without making someone eligible.
International and domestic titles are separate awards. Historical title evidence
is labeled with its publication date; retirement does not remove a profile.
Documented domestic revocations do not imply revocation of WXF titles.

### Import and review

Install the PDF parser in the Python environment used for data work:

```powershell
python -m pip install -r tools/games_database/requirements-players.txt
```

Preview a source refresh, inspect its report, then commit:

```powershell
python -m tools.games_database.player_import
python -m tools.games_database.player_import --apply
```

The default sources are WXF's linked official title PDF, the complete official
2022 CXA registration roster, reviewed later title-status notices, and all
Xiangqiqipu directory profiles. Official publications refresh weekly and profile
pages monthly. Downloads are sequential, bounded, cached and content-addressed;
304 responses preserve original evidence dates. `--offline` replays cached files.
A failed download or changed parser format fails before catalog writes. Missing
source rows never delete people, titles or editorial content. The CXA notice
index is checked for additional title/registration/status publications; these
appear in `publicationsForReview`, rather than being mistaken for final awards.
New publication formats require a reviewed adapter/manifest update.

To export deployment data from the populated canonical database, then import it
without network requests:

```powershell
python -m tools.games_database.player_import.export --destination data/local/player-import/deployment
python -m tools.games_database.player_import --input data/local/player-import/deployment/initial.json --decisions data/local/player-import/deployment/decisions.json --edits data/local/player-import/deployment/portraits.json --apply
```

The initial database contains normalized facts from 355 WXF records, 935 CXA
registration rows, 223 Xiangqiqipu profiles and 19 domestic-title status records
from three later notices. It contains no copied biography prose or downloaded portraits. Source
URLs, publication dates, observation timestamps and evidence hashes accompany
records. The local raw evidence is under `data/local/player-import/cache`.
Newer imported records are never replaced by an older deployment snapshot.
Bootstrap and portrait payloads are generated database exports, not Git fixtures.
The exporter preserves canonical source identities and unresolved review decisions.
It fails if a canonical identity lacks the original source needed to recreate it.

Matching uses a known external ID first, then a unique native name with agreeing
identity evidence. Romanization alone never merges people. Multiple entries for
the same native name in one publication are held for review. Unresolved homonyms
also suspend automatic name-based game attribution, preventing the first imported
person from inheriting all namesakes' games. Explicit reviewed game-side links
resolve these cases without copying games or rewriting source spellings.

Every run writes a JSON report under `data/local/player-import` and committed
runs are recorded in `player_import_runs`. Reports include discovered/matched/new
counts, unresolved identities, conflicting facts and population coverage.
`--report PATH` chooses a durable named report. Repeating the initial batch creates
no players and refreshes no unchanged statistics.

Identity decisions use `--decisions PATH` with a JSON object mapping source keys
such as `xiangqiqipu:197` to an existing canonical ID, `new`, `review`, or `ignore`.
An already matched identity cannot be reassigned by this command; merges require
a separate reviewed migration to preserve URLs and account/follow references.

`--edits PATH` accepts reviewed profile changes and per-game links:

```json
{
  "players": {
    "wxf:IGM0002": {
      "changes": {"biography": {"en": "Reviewed factual biography."},
                  "biographySources": ["https://example.org/source"]},
      "unlock": []
    }
  },
  "gameLinks": [
    {"gameId": "g:existing-game-id", "color": "red", "playerId": "wxf:IGM0002",
     "sourceUrl": "https://example.org/game"}
  ]
}
```

Use `--sources none --edits PATH --apply` for an editorial-only run. Changes are
locked against future imports; `unlock` releases chosen fields on the next
refresh. `onlyIfMissing: ["photo"]` fills an absent portrait without overwriting an
existing one during deployment. `playerId: null` explicitly leaves that game side unresolved. Unknown
player/game IDs fail the transaction. Biographies require source URLs. External
published photos require source URL, credit and license; uploads use Picfit.

New Xiangqiqipu portraits are initially permission-required candidates. Approved
portraits are canonical `photo` records containing the HTTPS URL, attribution,
display permission and its confirmation date. Display permission was confirmed
for the initial 223 candidates; 222 have valid image URLs and are published locally.
Lin Yanqiu's source contains only the image host root, so that profile retains
the normal fallback until a real portrait is available. The parser rejects this placeholder.
Their URLs and permission records live in the database and ignored deployment
exports; no portrait files or per-player portrait fixture is committed to Git.
Approved photos are editorially locked against later scraper refreshes. Imported English
and Chinese summaries use structured facts; fuller biographies remain editable.
Ratings/points from secondary directories are not promoted to official ratings.
Registered affiliations retain their roster date and are shown separately from
the most recently recorded game team.

### Application and deployment

The Scala directory only reads the catalog and sends authenticated editorial
updates. The former independent Scala WXF scraper/bootstrap scheduler is removed.
Public reads use `POST /players`; pass `titledOnly: false` to list the full registry.
Internal writes use `POST /internal/players` with the dedicated player credential.
Source ingestion is a server-side command, never a page request or public endpoint.

For an existing v1 SQLite player catalog, stop writers and migrate explicitly:

```powershell
python -m tools.data_migration.20261026_player_registry --database data/local/xiangqi-games.sqlite3 --backups data/local/migration-backups --writers-stopped
```

This snapshots every affected player table, original DDL, indexes and triggers
into a checksummed JSON backup before removing the superseded `professional`
column. Games are not rewritten. The snapshot retains column order and every
original row, including cached statistics and aliases, for reconstruction under
the previous schema. A failed migration rolls back its SQL transaction. Ordinary
startup refuses the old schema with the migration command in its error.

Installations with legacy Mongo directory collections must also run
`tools.data_migration.20261026_player_catalog`. Its immutable BSON backups and
explicit stopped-writer gate remain required. Accounts and follows stay in Mongo.

`push-local-live` packages the importer, pinned PDF dependency and
both migrations. Its existing `-MigratePlayerCatalog` switch authorizes schema
migration; otherwise it only checks readiness. Packaging exports the initial facts
and approved portraits directly from the canonical local database. Deployment
imports these records, fills missing portraits, and installs
`/etc/cron.d/lixiangqi-player-registry` for Monday 04:31 in the
server timezone. The wrapper `scripts/cron/update-player-registry.sh` and deployment
migration share a `flock` lock. Evidence and reports persist in the existing SQLite
data mount. Code rollback is blocked across incompatible migration contracts.
No production deployment or live cron installation is performed by local import.
