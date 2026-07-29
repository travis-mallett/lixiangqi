# Xiangqi opening explorer

The analysis-board explorer is a Xiangqi-native port of the Lichess opening
explorer, not a proxy to an international-chess endpoint.

## Upstream ledger

- Lichess UI reference: `ui/analyse/src/explorer/` and
  `ui/analyse/css/explorer/` at Lila commit
  `1b02f3c8754e5b389f42e6a8d9b6cedcc870ff69`.
- Explorer service reference:
  [lichess-org/lila-openingexplorer](https://github.com/lichess-org/lila-openingexplorer)
  commit `38bddd031a30a3d17dad041d20baf86fcb91e038`.
- The upstream explorer CSS is imported directly by the Xiangqi stylesheet.
  The Xiangqi controller and response model preserve the three database modes,
  outcome counts, move totals, filters, top games, and recent games.

The international-chess controller cannot be imported directly because it is
coupled to `chessops`, `scalachess`, an 8x8 FEN model, SAN, and white/black
roles. Lixiangqi keeps the same component boundary while using its native 9x10
position model, UCI coordinates, WXF notation, and Red/Black roles.

## Databases

- **Masters** reads `source = dpxq` from the local explorer database.
- **Lixiangqi** reads all native persisted Lixiangqi games.
- **Player** applies a player and Red/Black filter to the Lixiangqi games.

The current vertical slice does not yet persist live Lixiangqi games, so the
last two modes correctly return no games until the native game domain described
in `LIXIANGQI_ENGINE_BOUNDARY.md` is implemented. They do not fall back to
engine or cloud-book data.

## Games Database

The Tools menu links to `/xiangqi/games`, a server-side catalog over the same
canonical game and source-membership tables used by the opening explorer. The
source panel can combine Master Games with any DPXQ online category. Its English
labels preserve the underlying owner codes, including Top Blitz Games (`k`),
Online Tournaments (`n`), and Player Uploads (`u`).

The catalog returns at most 100 rows per page. Search covers native and
romanized player names plus event, title, class, group, place, opening, and
round metadata. Source, date, players, result, event, round, and move count are
sortable on the server. A canonical game is returned once even when several
selected DPXQ collections point to it; all of its provenance badges remain
visible on that row.

Selecting a row opens `/analysis?game=<canonical-id>`. The analysis page first
restores the locally saved workspace and then loads the stored, validated UCI
main line in a new database-game tab. Closing that tab returns to the existing
analysis without discarding its position tree or variations.

## Native game viewing and analysis tabs

Top Games and Recent Games never navigate to DPXQ. Each explorer game response
includes its validated stored UCI main line, which is loaded through the native
analysis import boundary. Selecting a game opens a named analysis
tab at the game's final position while leaving the current analysis tab intact.

The tab strip below the board and analysis panel supports switching, closing,
keyboard navigation, and creating a fresh analysis with `+`. Closing the active
game returns to the tab immediately on its left. Every tab owns an independent
starting FEN, variation tree, and selected position; the complete workspace is
saved locally and restored after a reload. Reopening an already-open explorer
game selects its existing tab instead of creating a duplicate.

## DPXQ retrieval and import

DPXQ publishes master games as individually numbered DhtmlXQ HTML records. The
scraper preserves each record locally, immediately validates and imports it,
then commits it before requesting the next ID. Start with a bounded five-game
check:

```powershell
.\.venv\Scripts\python.exe -m tools.xiangqi_data.dpxq_scrape `
  --start 141798 --count 5 `
  --output data\local\dpxq-master-html `
  --database data\local\xiangqi-explorer-dpxq.sqlite3
```

The complete currently numbered collection can be retrieved with:

```powershell
.\.venv\Scripts\python.exe -m tools.xiangqi_data.dpxq_scrape `
  --start 1 --end 141802 `
  --output data\local\dpxq-master-html `
  --database data\local\xiangqi-explorer-dpxq.sqlite3
```

The command is resumable from the repository root:

```powershell
.\.venv\Scripts\python.exe -m tools.xiangqi_data.dpxq_scrape `
  --start 1 --end 141802
```

The default one-second request-start interval makes a complete first pass take
at least 39.4 hours, excluding retries and per-game validation overhead. A
slow response consumes that interval rather than adding a second full wait.
On a normal restart, the scraper reads the highest committed master-game ID from
SQLite and jumps directly to the next ID. In `--download-only` mode it instead
uses the highest atomically saved final HTML filename. This avoids reparsing and
revalidating tens of thousands of completed records.

Use `--reconcile` when explicitly requesting a full range audit. Reconciliation
parses every saved page and checks its embedded DPXQ ID, repairing missing IDs,
invalid final files, abandoned `.partial` files, and gaps below later
downloads. `--overwrite` also starts from the requested first ID and
redownloads valid cached records.

Interactive terminals show one live pipeline bar. `D`, `C`, and `F` mean newly
downloaded, validated cache, and failed download. `DB I/E/R` means newly
imported, existing/deduplicated, and rejected by validation. Percentage and ETA
cover the requested source range. When output is redirected to a log, a
progress line is written every 100 records by default; change that interval
with `--progress-every`.

Every successful database write is committed immediately. The running
analysis board therefore sees new Masters explorer games throughout the long
scrape; it does not wait for the range to finish. If the process is interrupted,
both the last atomic HTML file and every already committed database row remain
available, and the same command safely resumes them.

SQLite write contention is treated as a temporary wait state. If another
scraper, maintenance process, or local service holds the catalog write lock,
the importer prints one waiting message and retries the blocked operation every
one second without a retry limit. It resumes automatically when the lock is
released and prints a continuation message. The same policy covers startup,
game writes, position indexing, metadata reconciliation, commits, and shutdown;
a lock is never counted as an invalid game. Unrelated SQLite errors still fail
normally instead of being hidden. This behavior is shared by the DPXQ master,
DPXQ online, GDChess/01xq, and XQDao import pipelines.

Use `--download-only` to preserve pages without importing them. DPXQ master
and online records default to `data/local/xiangqi-explorer-dpxq.sqlite3`.
GDChess/01xq defaults to `xiangqi-explorer-gdchess.sqlite3`, and XQDao defaults
to `xiangqi-explorer-xqdao.sqlite3`. Each source family therefore has one
SQLite writer and never waits for another scraper's commits. The read-only
catalog service attaches all installed source databases and deduplicates games
across them by canonical hash.

Set `LIXIANGQI_DPXQ_DB`, `LIXIANGQI_GDCHESS_DB`, or `LIXIANGQI_XQDAO_DB` to
override an individual source database. `LIXIANGQI_EXPLORER_DB` remains a
single-file compatibility override for the running service and tests.

To migrate an existing shared database, stop its scrapers and run:

```powershell
..\..\.venv\Scripts\python.exe .\split_explorer_database.py
```

The migration atomically creates the three source files and retains the
original `xiangqi-explorer.sqlite3` as a rollback backup.

The importer:

1. converts DhtmlXQ intersections to native Xiangqi UCI moves;
2. validates every complete move sequence through the official Pikafish engine;
3. rejects malformed, non-standard, illegal, or required-data-deficient records;
4. stores the complete parsed DhtmlXQ tag set as lossless JSON;
5. promotes player entries, affiliations, explicit countries, levels, source
   English names, ratings, event/group/place/time/table data, result details,
   records, remarks, authors, references, and source timestamps into columns;
6. deduplicates canonical games; and
7. indexes every pre-move position, including transpositions.

`redteam` and `blackteam` are stored as affiliations exactly as DPXQ publishes
them. International records sometimes put a country such as `Vietnam` in that
field, while domestic records may contain a province, club, employer, or sports
association. The importer therefore never relabels a team as a country. An
explicit `redcountry`/`blackcountry` (or equivalent nation tag) is stored in the
country column when supplied, and every original tag remains available in
`metadata_json` regardless.

## Multilingual player names

DPXQ player names remain lossless: `red_name` and `black_name` store the exact
normalized Unicode text from the source record. Separate columns store an
automatic romanization, the romanization system, and a compact search key. The
explorer displays both forms, for example `Wang Tianyi (王天一)`, while API
consumers can still access `nativeName` and `romanizedName` independently.

Romanization is selected from the script actually present in the name:

- Han characters use Hanyu Pinyin (`zh-Latn-pinyin-auto`), including compound
  Chinese surnames and joined given-name syllables;
- Japanese names containing kana use Hepburn (`ja-Latn-hepburn-auto`);
- Hangul uses South Korean Revised Romanization (`ko-Latn-rr-auto`); and
- names already written in Latin characters remain unchanged.

The `-auto` provenance is intentional. Han-only personal names do not encode
whether their intended reading is Chinese, Japanese, Korean, or Vietnamese, and
Japanese given-name readings and Korean passport spellings can be ambiguous.
The native form is therefore always authoritative; an automatic romanization
is a search/display aid, not an identity replacement. Re-importing an existing
deduplicated game backfills the romanization columns, so a resumed scrape also
migrates previously downloaded records.

The scraper identifies itself, enforces a minimum request interval, follows
`Retry-After`, retries transient failures with exponential backoff, uses atomic
files, rejects non-DhtmlXQ responses, and reports any missing IDs with a nonzero
exit status so the same range can be resumed.

## DPXQ online and uploaded collections

`dpxq_online_scrape.py` is the category-aware companion to the master scraper.
It keeps these DPXQ owner buckets distinct:

| Owner | DPXQ label | Notes                                      |
| ----- | ---------- | ------------------------------------------ |
| `n`   | 网络赛事   | Network competitions                       |
| `t`   | 顶尖对局   | VIP move data                              |
| `k`   | 顶尖快棋   | VIP move data                              |
| `o`   | 其他对局   | VIP move data                              |
| `b`   | 低于24步   | May contain incomplete/nonstandard records |
| `u`   | 棋友上传   | Heterogeneous user uploads                 |
| `w`   | 无主棋谱   | Sparse filtered view of uploaded IDs       |

Run a five-record reconciliation for every non-master category from the
repository root with:

```powershell
.\.venv\Scripts\python.exe -m tools.xiangqi_data.dpxq_online_scrape --count 5
```

For the VIP collections, copy the authenticated DPXQ request cookie from the
account's browser session into the process environment, not the command line or
source code:

```powershell
$env:DPXQ_COOKIE = '<authenticated DPXQ Cookie header value>'
.\.venv\Scripts\python.exe -m tools.xiangqi_data.dpxq_online_scrape `
  --categories t,k,o --count 5
Remove-Item Env:DPXQ_COOKIE
```

Each category has its own HTML cache directory under
`data\local\dpxq-online-html`. The importer stores unique online games as
`source = dpxq_online`. The normalized `game_sources` table records every DPXQ
owner, numeric source ID, label, URL, and complete source metadata. If identical
game content appears in several categories—or already exists in Masters—there
is still only one game and position index, with multiple source records pointing
to it. This prevents combined-category explorer searches from double-counting
the game while preserving all provenance.

Sequential collections use their requested numeric range. `w` is different:
DPXQ implements 无主棋谱 as a sparse filter over uploaded IDs, so the scraper
enumerates its list page instead of incorrectly assuming that every ID belongs
to it. `--list-pages` controls how many list pages are available for a bounded
sample.

The online scraper has the same atomic cache, immediate database commit,
Pikafish legality validation, retry, gap-filling, and rerun behavior as the
master scraper. Access shells with withheld VIP moves, nonstandard starting
positions, missing players/results, and illegal move sequences are not marked
successful. They remain gaps and are reconsidered on a later run.

## GDChess/01xq game collection

GDChess and its English 01xq companion publish a browsable game-record
database, not an online-play history. The current global listing reports about
113,680 games, but deliberately exposes at most ten pages. Game identifiers are
opaque hexadecimal strings, so incrementing an integer cannot enumerate the
collection. `gdchess_scrape.py` instead walks the GDChess event catalog (about
3,550 events across 119 pages at the time of investigation), then reads each
event's uncapped 01xq game list to discover the complete game IDs and English
metadata.

Run the bounded five-game verification from the repository root:

```powershell
.\.venv\Scripts\python.exe -m tools.xiangqi_data.gdchess_scrape --count 5
```

Start a complete traversal with:

```powershell
.\.venv\Scripts\python.exe -m tools.xiangqi_data.gdchess_scrape --full
```

An interrupted full traversal resumes at the last event in the contiguous
cached traversal and the first game after its latest committed source row.
Scattered event listings from targeted runs do not move this cursor. The
scraper does not revalidate and re-import every earlier game. In
`--download-only` mode a game counts as complete only when both its HTML page
and JSON listing sidecar exist. Use `--reconcile` to deliberately scan all
earlier events and repair historical gaps; `--refresh-listings` and
`--overwrite-games` also disable fast resume.

The scraper stores catalog pages, event listings, complete native game pages,
and a JSON listing sidecar under `data\local\gdchess-01xq-html`. It commits each
legal game immediately to its `xiangqi-explorer-gdchess.sqlite3` database and
records `source = gdchess_01xq` provenance. Exact games already present from
DPXQ or another source reuse the canonical game and position index while
retaining an additional GDChess/01xq source record.

The Games Database presents this as one top-level `GDChess / 01xq` source.
Event categories, competition formats, and the presence of AI analysis are
metadata attributes rather than mutually exclusive source collections, so
they are not represented as source children.

Restart by running the identical command. Use `--refresh-listings` on a later
update pass to re-fetch catalog and event pages and discover newly published
games; use `--overwrite-games` only when intentionally refreshing all selected
native game HTML.

For every game, the importer preserves the native and English player names,
native and English event names, date, round, table, result, listed ply count,
opening, views, source update time, URLs, and optional GDChess engine score/move
arrays. The complete move sequence must agree with the listing and pass
Pikafish before it is indexed. GDChess/01xq HTTPS connections were unavailable
during testing, while their HTTP endpoints worked consistently, so the scraper
uses the sites' published HTTP URLs, identifies itself, and defaults to a
one-second interval with a hard minimum of 0.5 seconds.

A full first pass requires roughly 113,680 game requests plus approximately
3,669 discovery requests. At the default delay, network pacing alone is about
32.6 hours, before retries and Pikafish validation time.

## XQDao game collection

XQDao's public site describes a million-scale Xiangqi record/search warehouse,
but its own anonymously browsable, complete-game archive is smaller and is not
the short list suggested by the visible navigation. The `/dashi/` event index
accepts undocumented `?page=N` pagination even though it renders no pager. A
complete traversal on 2026-07-22 found:

- 65 populated hidden event-index pages; page 66 was the first empty page;
- 1,622 event collections;
- 3,069 event-listing pages; and
- 63,395 unique public full-game links after deduplicating XQDao game IDs.

No XQDao membership was required. Anonymous game pages expose their DhtmlXQ
move lists and metadata. DPXQ-backed position-search tools advertised on those
pages are a separate service and are not used by this importer.

Run the bounded five-game verification from the repository root:

```powershell
.\.venv\Scripts\python.exe -m tools.xiangqi_data.xqdao_scrape --count 5
```

Rebuild the exact public-link manifest without downloading game pages:

```powershell
.\.venv\Scripts\python.exe -m tools.xiangqi_data.xqdao_scrape --discover-only
```

Start the complete download and import with:

```powershell
.\.venv\Scripts\python.exe -m tools.xiangqi_data.xqdao_scrape --full
```

The scraper stores hidden index pages, hashed event-listing cache directories,
the complete source HTML, per-game JSON sidecars, and `manifest.json` under
`data\local\xqdao-html`. Event pages are followed to their actual last page;
game IDs are never guessed by incrementing through XQDao's mixed record ID
space, which also contains openings, middlegames, endgames, and puzzles.

Every detail page must describe a standard-start full game and supply a complete
move list. The importer preserves native players and affiliations, recognizes
explicit country affiliations, and stores event, date, round, opening, place,
table, result, notes, the original DhtmlXQ fields, all discovered event
associations, and source URLs. The moves must pass Pikafish before the game is
indexed. It commits each accepted game immediately and records
`source = xqdao`, `collection = games` provenance; canonical duplicates from
DPXQ or GDChess reuse the existing game and position index.

Restart by running the identical command. Valid index, event, and game cache
files are not fetched again. Already committed XQDao source IDs are skipped
before any game-page request or Pikafish replay. Missing pages, incomplete
discovery branches, and rejected games remain gaps and are retried. XQDao's
commits go only to `xiangqi-explorer-xqdao.sqlite3`, so DPXQ and GDChess writes
cannot block them. `--refresh-listings` is the explicit update pass for new
XQDao events/games; `--overwrite-games` refreshes selected source pages.

The Games Database exposes this corpus as one top-level `XQDao` source. Event
names and historical archive groupings remain searchable metadata, not source
checkbox children.
