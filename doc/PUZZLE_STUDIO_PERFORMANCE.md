# Puzzle Studio: lightweight database navigation

## Findings

The September 15, 2026 investigation used a local mining store of approximately
10 GB with 59,767 candidates and 3,943 mined puzzles, plus 2,339 catalog records.
The data volume was mostly evidence and source history, not list metadata.

The main problems were:

- Opening the GUI invoked the writable schema opener, including full database
  backup and migration work. Importing live puzzle identities also copied the
  entire mining database.
- Library pages and counts traversed candidate work that could never appear in
  the library. Queries fetched large source/evidence records to obtain small
  metadata fields, expanded JSON, and repeated that work for counts and pages.
- Category inventory read proof payloads and repeatedly evaluated taxonomy JSON.
- Publication membership was reconstructed by the viewer from release archives.
  The overview also parsed archived releases to calculate unused release counts.
- Cancelling a Python future did not stop an already-running SQL statement.
  Obsolete filters could occupy both reader threads.
- The library stopped automatic refresh when any row was selected. Its default
  first-row selection consequently stopped updates almost immediately.

## Read architecture

The database owns compact covering indexes and views for candidates, assessment
eligibility, taxonomy versions, and puzzle listing fields. Full source histories
and evidence are fetched by primary key only when opening a puzzle's details.
There is no engine work, migration, backup, reconciliation, or release-archive
processing in a normal Studio read.

Theme membership is relational and indexed by `(theme, puzzle_id)`. SQLite
triggers maintain it inside the original write transaction, including updates,
replacement inserts, deletions, and rollbacks. Publication membership belongs to
the catalog and updates only when its authoritative baseline/release changes.
The superseded viewer-owned publication projection is removed.

Library filtering excludes raw candidate work before planning the query. Theme
filters enter through the theme index before constructing rows. Sorting operates
on compact indexed fields, and the GUI receives only the requested page. Counts
and rows share a short read transaction. Category queue eligibility remains the
same canonical predicate used by workers; its inventory query uses small indexed
fields and materializes the small taxonomy/eligible sets once per request.

This follows SQLite's [covering-index design](https://sqlite.org/queryplanner.html#covidx).
With [WAL](https://sqlite.org/wal.html), readers can coexist with a writer, but
long-lived read transactions can delay checkpoints. Studio closes each request's
snapshot promptly. Its persistent change observers only read `PRAGMA data_version`
and do not hold transactions. No dirty reads or `immutable=1` shortcuts are used.
The local Z: drive used for verification is a fixed local disk.

## Refresh and scheduling

- The existing configurable refresh interval defaults to five seconds. SQLite
  commit versions invalidate a bounded cache; unchanged data does not rerun SQL.
- The overview refreshes independently of the library. Library work runs when
  that page is opened or visible, and automatic ticks do not supersede an active
  page request.
- New filters cancel superseded SQLite work through a progress handler. Closing
  Studio also cancels pending reads instead of waiting for obsolete queries.
- Changes preserve multi-selection and the selected board position. Unchanged
  rows/facets are not rebuilt, and evidence loads remain separate from listing.
- Transient SQLite busy/locked results retain the existing display and retry on
  the next refresh. WAL still permits only one writer; the viewer does not turn
  normal navigation into a competing writer.
- Generation supervisors and their children run below normal priority so that
  interactive applications receive CPU time during engine contention.

“Live” means the latest committed local mining/catalog state. Published membership
reflects the master's inventory downloaded through the existing explicit
reconciliation/publication workflow; opening Studio does not contact production.

## Installation and data policy

The existing checkout's databases have been prepared. Restart Studio to load the
new reader code. Ordinary writable mining/catalog openers install missing read
indexes for newly created databases. For another existing checkout, prepare the
additive indexes once, without running schema migrations or making data copies:

```powershell
.venv/Scripts/python.exe -m tools.data_migration.20260915_puzzle_inventory_indexes --mining data/local/xiangqi-puzzle-mining.sqlite3 --catalog data/local/puzzle-catalog.sqlite3
```

Routine local mining initialization and live-position imports no longer create
full database backups. Schema upgrade steps retain their transactional rollback
and committed version markers; failed steps can be retried. Studio itself never
runs those upgrades. Existing backup files are left in place. Explicit historical
repair utilities and production/user-data backup procedures are separate.

The adjacent `push-local-live.ps1` was inspected. These are local SQLite/tool
changes; the live site's MongoDB schema, publication protocol, and deployment
payload do not change, so no server deployment step is required.

## Verification

Tests cover indexed plans, theme replacement/deletion/rollback, committed versus
uncommitted visibility, cache invalidation, publication membership, checkpoint
progress, SQL cancellation, startup isolation, process priority, and preservation
of multi-selection and board position. Existing mining, publication, and desktop
workflow tests run alongside these regressions.

Final verification passed 411 tests: 253 mining tests, 73 desktop tests, and 85
catalog/publication tests. Black checks, targeted Ruff checks, and Git diff
whitespace validation also passed.

Five-run medians against the actual local database (warm reads, 100-row pages):

| Read                       |  Median |
| -------------------------- | ------: |
| Overview counts            |  254 ms |
| Library, newest first      |   50 ms |
| Angler Horse filter        |  6.6 ms |
| Library, longest first     |   49 ms |
| Filter choices             |   20 ms |
| Selected puzzle detail     |  2.1 ms |
| Unchanged overview refresh | 0.03 ms |

A synthetic 100,000-puzzle library loaded in 195 ms, sorted by length in 201 ms,
filtered a one-percent theme in 28 ms, and loaded one detail in 21 ms while a
second connection committed continuously. There were 34 concurrent commits and
no lock failures during those reads. These are local measurements, not a latency
guarantee for every disk, database size, or worker load.

Repeat the actual database measurements, including with workers running:

```powershell
.venv/Scripts/python.exe -m tools.puzzle_catalog.desktop.benchmark --catalog data/local/puzzle-catalog.sqlite3 --mining data/local/xiangqi-puzzle-mining.sqlite3 --state data/local/puzzle-studio --iterations 5
```

The benchmark reads actual repository methods. It does not start engines, change
puzzle content, migrate databases, or create data copies. It reports wall-clock
and process CPU time separately; Windows CPU-clock resolution can report zero
for very short reads.
