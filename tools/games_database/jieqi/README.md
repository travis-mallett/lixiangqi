# Local jieqi collection

This collector stores public source evidence and validated jieqi records in
`data/local/jieqi-games/collection.sqlite3`. It never opens the website's games
database, publishes records, or updates the explorer. Mistboard is excluded.
No additional Python libraries are needed beyond the repository environment.

**Incomplete: no complete remote jieqi game has been downloaded and verified.**
This is experimental discovery infrastructure, not a working game scraper.
No sources are enabled by default. Tournament results, software downloads and videos are kept
as references, never counted as games. Unsupported payloads remain recoverable
for a future source adapter; no guessed endpoints or fabricated reveal mappings
are used.

## Run

Run from the repository root. On Windows use the existing Python environment:

```powershell
& .venv/Scripts/python.exe -m tools.games_database.jieqi sources
& .venv/Scripts/python.exe -m tools.games_database.jieqi run --sources xqipu
```

On Linux use `python3` in place of `.venv/Scripts/python.exe`.
An explicitly selected experimental run attempts at most 1,000 queued pages, with a 2-second request
interval, 30-second socket timeout, three retries after the initial attempt,
and a discovery depth of five. Repeat the same command to continue. Use a small
bounded run first:

The 1,000 limit is a per-invocation request/work budget, not an estimate of
available games or a lifetime collection limit. Increase it with
`--max-pages 10000`. Each attempt now prints its URL, outcome and cumulative
validated game/fragment counts. Queued pages can include paused sources, and
discovery can add pages, so no misleading completion percentage or ETA is shown.

```powershell
& .venv/Scripts/python.exe -m tools.games_database.jieqi run --sources xqipu --max-pages 10
& .venv/Scripts/python.exe -m tools.games_database.jieqi status
& .venv/Scripts/python.exe -m tools.games_database.jieqi export data/local/jieqi-games/records.jsonl
```

`--directory PATH` goes **before** the command and selects another isolated
collection directory. `--sources dpxq xqipu` limits collection to those sources.
Progress includes source/job IDs; the final JSON report separates full games,
unfinished lines, fragments, references, failures, blocked sources and review
items. Exit codes: 0 successful bounded run (possibly still pending work),
2 selected sources have blocked/failed/review items, 1 infrastructure error,
130 cancellation. A zero exit code does not imply discovery is exhaustive.

Validation requires Java 21 and **current staged native rules**. On the prepared
Windows checkout, discover the installed patch version and stage if needed:

```powershell
$taskJava = Get-ChildItem '.tools/jdk-21/*/bin/java.exe' | Select-Object -Last 1 -ExpandProperty FullName
& $taskJava '-Dsbt.server.autostart=false' -jar .tools/sbt/sbt-launch-2.0.3.jar stage
if ($LASTEXITCODE -ne 0) { throw 'Native rules staging failed' }
```

The validator starts a bounded offline JVM only when a candidate record is
found and closes it on completion/cancellation. No web app, engine, MongoDB or
other service is needed. The stage is a build prerequisite, not a deployment.

## Continuation and recovery

- Ctrl+C/SIGTERM keeps committed work. Repeat the command; no cursor can skip
  an uncompleted URL. Process termination during a transaction rolls it back.
- Each response is content-addressed and committed before parsing. A crash
  during validation resumes from those bytes without another download.
- Record, source witness, discovered children and page completion commit in
  one SQLite transaction. Depth-limited children stay queued for a later run
  with a higher `--max-depth`.
- An OS file lock prevents two writers using one directory and releases on
  process death. Do not delete the lock file to bypass an active collector.
- Transient network errors retry with exponential backoff. `Retry-After`
  survives cancellation and applies to the whole source. Long waits are left
  queued for another invocation. Exhausted errors require `--retry-failed`.
- Authentication and human-verification challenges pause that source across
  runs. Resolve access before running `run --retry-failed`.
- `run --refresh` refetches completed/review pages for new links or corrections.
  `run --offline --reparse` reprocesses their cached bytes after parser changes.
  Old responses, records and provenance are retained in both cases. Changed
  records are retained as distinct revisions, not silently overwritten.
- JSONL export uses a temporary file and atomic replacement. SQLite remains
  the authority. To back up the collection, stop the collector and copy the
  directory, or use SQLite's backup API while it is open.

Cookies, when necessary, are read from exact-host environment variables, e.g.
`JIEQI_COOKIE_WWW_DPXQ_COM`. They are not printed or stored and are stripped
on cross-host redirects. Use your authorized session; the collector does not
solve challenges or bypass login. Saved source pages can also be imported.

## Sources and realistic yield

Audited 2026-11-02 using bounded direct HTTP probes and the preceding public-web
research. No full scrape was run. Counts below are evidence-based lower bounds,
not statistical estimates of inaccessible/private collections.

| Source | Current support and audit result | Defensible full-game yield |
| --- | --- | --- |
| DPXQ | Jieqi tournament index and linked pages; direct request returned a login gate. No jieqi move/reveal archive verified. | 0 confirmed; unknown after authenticated discovery |
| XQipu | Real `keyword=揭棋` search and explicit FEN/ICCS fragments. Indexed 11-ply and 2-ply analysis fragments; direct record HTTP returned human verification. Search showed 20 links and a login-to-see-more notice; most are ordinary games involving a team named 揭棋. | 0 verified full games; a handful of fragments/candidates |
| GDChess/01xq | Jieqi event links, same-event pages and published score links. Mixed-event articles do not cause ordinary-xiangqi event imports. Audited Ningming event provides jieqi results, not a verified score collection. | 0 confirmed |
| Việt Cờ Tướng | Published jieqi-related game/library links and explicit supplied URLs. Dynamic game payload/API mapping remains unverified. Large advertised library counts are not jieqi counts. | Unknown; budget 0 verified |
| Xiangqiqipu | Wang Tianyi video directory pagination and explicitly jieqi-labeled video pages. Preserves page references, not video media or transcription. | 0 structured records automatically |
| Pengfei | Software/reference page. Does not download or execute installers. No public human-game archive verified. | 0 confirmed |
| Zhongyi / jk1618 | Historical homepage and published jieqi-related record links. Initial probe timed out; later response was a game-download portal, with no verified score archive. | Unknown; budget 0 verified |
| Xiuqipu | Export-tool reference page. No calls to its third-party parsing service; its ordinary DhtmlXQ output does not establish preservation of jieqi reveals. | 0 verified jieqi records |

**Planning estimate: zero guaranteed complete high-level games from the current
public seeds; two short fragments are evidenced in indexed pages, with other
unverified jieqi-labeled candidates.** It
would be misleading to quote hundreds/thousands. The status report gives actual
unique validated totals after access and source formats are established. Raw
page counts, tournament pairings and video counts are not extrapolated to games.

## Additional URLs and saved records

```powershell
& .venv/Scripts/python.exe -m tools.games_database.jieqi import-file xqipu 'https://www.xqipu.com/qipu/ACTUAL-ID' data/local/saved-jieqi.html
```

Replace example URLs with actual record URLs. Every source URL is checked
against its host allowlist, including redirects. Local import reads one saved
HTML page, one coordinate PGN game, or one normalized JSON record (maximum 4 MB).
There is no support claim for proprietary Pengfei/CBL/XQF jieqi encodings.
Tiantian and Mistboard are outside this project's scope. Collection exits with
code 3 if the selected sources have no complete games, including when pages or
fragments were successfully saved. Existing cached data is preserved.

The explicit interchange format is:

```json
{
  "schema": "lixiangqi-jieqi-record-v1",
  "variant": "jieqi",
  "ruleset": "jieqi-v1",
  "red": "Original red player name",
  "black": "Original black player name",
  "result": "*",
  "moves": ["a4a5~soldier", "a7a6~horse"]
}
```

This example is an unfinished line, not an observed source game. Optional
`initial_fen` defaults to the concealed starting position; custom positions
are classified as fragments. `event`, `date` and `title` are optional strings.
Coordinates are one-based (`a1`–`i10`); `~role` records the moving piece's reveal,
and a second `~role` records known identity of a captured concealed piece.
Use `~~role` for such a capture by an already revealed piece. Roles are
`chariot`, `horse`, `elephant`, `advisor`, `cannon`, `soldier`.

The native rules validate legality, side to move, reveals and remaining piece
inventory. Missing reveals never become fabricated identities. Native terminal
results must agree with published results; nonterminal decisive records may
represent resignation/time loss. Imported records are not certified high-level
human games: source names and result metadata remain unverified assertions.

Deduplication reuses the existing catalog hash primitives but includes jieqi
ruleset, starting FEN, full moves **with reveals/captured identities**, players
and result. Dates/event spelling do not prevent exact duplicates merging. All
source witnesses and immutable raw responses survive. Anonymous records are
not merged across URLs; matching line hashes flag candidates for review.
Aliases, partial lines and differing knowledge are not automatically merged.

## Verification

```powershell
& .venv/Scripts/python.exe -m unittest tools.games_database.jieqi.test_collector
```

Tests cover cancellation during fetch/validation, process restart, atomic
rollback, cached/offline continuation, depth-budget continuation, deduplication,
source revisions, auth challenges, retry exhaustion/Retry-After, checksums,
single-writer locking, variant false positives, and a real jieqi replay through
the staged native rules. The puzzle-mining CI workflow runs this suite after
staging those rules. No production migration or deployment changes are needed.
