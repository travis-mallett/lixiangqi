PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- One row per resolved game/example. Source publications are stored separately
-- in game_sources, so provenance never has to be discarded during de-duplication.
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  canonical_hash BLOB NOT NULL UNIQUE,
  line_hash BLOB NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'played_game'
    CHECK (record_kind IN ('played_game', 'manual_example', 'composed_position', 'analysis_line', 'problem')),
  statistical_eligible INTEGER NOT NULL DEFAULT 1 CHECK (statistical_eligible IN (0, 1)),
  variant TEXT NOT NULL DEFAULT 'xiangqi',
  initial_fen TEXT NOT NULL DEFAULT '',
  red_name TEXT NOT NULL,
  red_name_romanized TEXT,
  red_name_romanization TEXT,
  red_name_key TEXT NOT NULL DEFAULT '',
  red_entry TEXT NOT NULL DEFAULT '',
  red_team TEXT NOT NULL DEFAULT '',
  red_country TEXT NOT NULL DEFAULT '',
  red_level TEXT NOT NULL DEFAULT '',
  red_name_english TEXT NOT NULL DEFAULT '',
  red_time TEXT NOT NULL DEFAULT '',
  black_name TEXT NOT NULL,
  black_name_romanized TEXT,
  black_name_romanization TEXT,
  black_name_key TEXT NOT NULL DEFAULT '',
  black_entry TEXT NOT NULL DEFAULT '',
  black_team TEXT NOT NULL DEFAULT '',
  black_country TEXT NOT NULL DEFAULT '',
  black_level TEXT NOT NULL DEFAULT '',
  black_name_english TEXT NOT NULL DEFAULT '',
  black_time TEXT NOT NULL DEFAULT '',
  red_rating INTEGER,
  black_rating INTEGER,
  result INTEGER NOT NULL CHECK (result IN (-1, 0, 1)),
  played_at TEXT NOT NULL,
  year INTEGER,
  month TEXT,
  event TEXT NOT NULL DEFAULT '',
  round TEXT NOT NULL DEFAULT '',
  opening TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  game_type TEXT NOT NULL DEFAULT '',
  game_class TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  time_rule TEXT NOT NULL DEFAULT '',
  table_name TEXT NOT NULL DEFAULT '',
  end_type TEXT NOT NULL DEFAULT '',
  judge TEXT NOT NULL DEFAULT '',
  game_record TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  other TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL DEFAULT '',
  edited_at TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  moves TEXT NOT NULL,
  notations TEXT NOT NULL,
  source_url TEXT NOT NULL
);

-- Opening statistics use the first occurrence of a position in each canonical
-- game. This prevents repetitions from contributing more than once.
CREATE TABLE IF NOT EXISTS game_positions (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL,
  position_key TEXT NOT NULL,
  move TEXT NOT NULL,
  notation TEXT NOT NULL,
  PRIMARY KEY (game_id, position_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  alternate_titles_json TEXT NOT NULL DEFAULT '[]',
  attributed_author TEXT NOT NULL DEFAULT '',
  era TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS editions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  editor TEXT NOT NULL DEFAULT '',
  translator TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  identifier TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

-- One source witness per downloaded page, PGN game, or manual record.
CREATE TABLE IF NOT EXISTS game_sources (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  collection TEXT NOT NULL,
  collection_name TEXT NOT NULL,
  external_id TEXT NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  edition_id TEXT REFERENCES editions(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  raw_checksum TEXT NOT NULL DEFAULT '',
  parser_version TEXT NOT NULL DEFAULT '',
  acquired_at TEXT NOT NULL DEFAULT '',
  locator_json TEXT NOT NULL DEFAULT '{}',
  match_method TEXT NOT NULL DEFAULT 'canonical_hash',
  match_confidence REAL NOT NULL DEFAULT 1.0
    CHECK (match_confidence >= 0 AND match_confidence <= 1),
  mainline_hash BLOB,
  mainline_moves TEXT,
  notation_text TEXT NOT NULL DEFAULT '',
  UNIQUE (source, collection, external_id)
);

-- A layer owns related annotations: historical author commentary, a
-- translation, editorial notes, or one versioned engine analysis.
CREATE TABLE IF NOT EXISTS annotation_sets (
  id INTEGER PRIMARY KEY,
  source_record_id INTEGER NOT NULL REFERENCES game_sources(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  annotator TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  engine TEXT NOT NULL DEFAULT '',
  engine_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (source_record_id, kind, annotator, language, engine, engine_version)
);

-- Paths are space-separated UCI moves from the root. anchor_ply is retained
-- for compact mainline annotations; anchor_path is authoritative for branches.
CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY,
  annotation_set_id INTEGER NOT NULL REFERENCES annotation_sets(id) ON DELETE CASCADE,
  anchor_kind TEXT NOT NULL
    CHECK (anchor_kind IN ('record', 'root', 'move', 'position', 'variation')),
  anchor_ply INTEGER,
  anchor_path TEXT NOT NULL DEFAULT '',
  annotation_type TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  source_key TEXT NOT NULL DEFAULT '',
  ordinal INTEGER NOT NULL DEFAULT 0,
  content_hash BLOB,
  translation_of INTEGER REFERENCES annotations(id) ON DELETE SET NULL,
  supersedes INTEGER REFERENCES annotations(id) ON DELETE SET NULL
);

-- Dense per-ply arrays (for example 01xq engine scores) stay structured
-- without creating millions of tiny annotation rows.
CREATE TABLE IF NOT EXISTS annotation_series (
  id INTEGER PRIMARY KEY,
  annotation_set_id INTEGER NOT NULL REFERENCES annotation_sets(id) ON DELETE CASCADE,
  series_type TEXT NOT NULL,
  values_json TEXT NOT NULL,
  moves_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (annotation_set_id, series_type)
);

-- Sparse source-specific branches. A witness with no variations uses the
-- canonical mainline directly and therefore stores no duplicate node rows.
CREATE TABLE IF NOT EXISTS source_tree_nodes (
  id INTEGER PRIMARY KEY,
  source_record_id INTEGER NOT NULL REFERENCES game_sources(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES source_tree_nodes(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  ply INTEGER NOT NULL,
  move TEXT NOT NULL,
  notation TEXT NOT NULL DEFAULT '',
  position_key TEXT NOT NULL DEFAULT '',
  is_mainline INTEGER NOT NULL DEFAULT 0 CHECK (is_mainline IN (0, 1)),
  child_order INTEGER NOT NULL DEFAULT 0,
  canonical_ply INTEGER,
  UNIQUE (source_record_id, path)
);

CREATE TABLE IF NOT EXISTS source_events (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (source, external_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  last_success_at TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (source, scope)
) WITHOUT ROWID;

-- The opening explorer follows Lichess's write-time projection model. Common
-- positions are aggregated into compact month buckets when games are imported;
-- HTTP reads never rescan and regroup the raw game-position catalog.
CREATE TABLE IF NOT EXISTS explorer_positions (
  id INTEGER PRIMARY KEY,
  position_key TEXT NOT NULL UNIQUE,
  game_count INTEGER NOT NULL CHECK (game_count >= 0)
);

CREATE TABLE IF NOT EXISTS explorer_stats (
  position_id INTEGER NOT NULL REFERENCES explorer_positions(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  move TEXT NOT NULL,
  notation TEXT NOT NULL,
  all_red INTEGER NOT NULL DEFAULT 0,
  all_draws INTEGER NOT NULL DEFAULT 0,
  all_black INTEGER NOT NULL DEFAULT 0,
  masters_red INTEGER NOT NULL DEFAULT 0,
  masters_draws INTEGER NOT NULL DEFAULT 0,
  masters_black INTEGER NOT NULL DEFAULT 0,
  dpxq_red INTEGER NOT NULL DEFAULT 0,
  dpxq_draws INTEGER NOT NULL DEFAULT 0,
  dpxq_black INTEGER NOT NULL DEFAULT 0,
  gdchess_red INTEGER NOT NULL DEFAULT 0,
  gdchess_draws INTEGER NOT NULL DEFAULT 0,
  gdchess_black INTEGER NOT NULL DEFAULT 0,
  xqdao_red INTEGER NOT NULL DEFAULT 0,
  xqdao_draws INTEGER NOT NULL DEFAULT 0,
  xqdao_black INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (position_id, month, move)
) WITHOUT ROWID;

-- As in Lichess's packed position entries, only bounded top/recent candidates
-- are retained for each time bucket. This makes representative-game lookup
-- independent of the number of games that reached the position.
CREATE TABLE IF NOT EXISTS explorer_samples (
  position_id INTEGER NOT NULL REFERENCES explorer_positions(id) ON DELETE CASCADE,
  database_id INTEGER NOT NULL,
  month TEXT NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  move TEXT NOT NULL,
  rating_sum INTEGER NOT NULL,
  played_at TEXT NOT NULL,
  sort_id TEXT NOT NULL,
  PRIMARY KEY (position_id, database_id, month, game_id)
) WITHOUT ROWID;

-- One marker per category prevents duplicate source witnesses from merging a
-- canonical game's statistics more than once.
CREATE TABLE IF NOT EXISTS explorer_indexed_games (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  database_id INTEGER NOT NULL,
  PRIMARY KEY (game_id, database_id)
) WITHOUT ROWID;

-- Compact, write-time accounting for newly catalogued canonical games. The
-- trigger is installed by the shared schema, so every current or future writer
-- is counted without importer-specific bookkeeping. Hourly UTC buckets keep
-- the table tiny while allowing exact midnight boundaries in Pacific time.
CREATE TABLE IF NOT EXISTS catalog_growth_hourly (
  bucket TEXT PRIMARY KEY,
  games_added INTEGER NOT NULL DEFAULT 0 CHECK (games_added >= 0)
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS games_track_catalog_growth
AFTER INSERT ON games
BEGIN
  INSERT INTO catalog_growth_hourly(bucket, games_added)
  VALUES (strftime('%Y-%m-%dT%H:00:00Z', 'now'), 1)
  ON CONFLICT(bucket) DO UPDATE
  SET games_added = catalog_growth_hourly.games_added + 1;
END;

-- Invalid source records are quarantined by content checksum. Incremental
-- scans skip the same rejected payload instead of re-validating it forever;
-- reconciliation or a changed source file can retry it explicitly.
CREATE TABLE IF NOT EXISTS ingest_failures (
  source TEXT NOT NULL,
  collection TEXT NOT NULL,
  external_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  error TEXT NOT NULL,
  raw_checksum TEXT NOT NULL DEFAULT '',
  parser_version TEXT NOT NULL DEFAULT '',
  first_failed_at TEXT NOT NULL,
  last_failed_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (source, collection, external_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS game_positions_by_position
  ON game_positions(position_key, game_id);
CREATE INDEX IF NOT EXISTS games_by_line_hash ON games(line_hash);
CREATE INDEX IF NOT EXISTS games_by_date ON games(month, played_at);
CREATE INDEX IF NOT EXISTS games_by_played_at ON games(played_at DESC, id);
CREATE INDEX IF NOT EXISTS games_by_year ON games(year);
CREATE INDEX IF NOT EXISTS games_by_red ON games(red_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS games_by_black ON games(black_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS games_by_red_romanized
  ON games(red_name_romanized COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS games_by_black_romanized
  ON games(black_name_romanized COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS games_by_red_key ON games(red_name_key);
CREATE INDEX IF NOT EXISTS games_by_black_key ON games(black_name_key);
CREATE INDEX IF NOT EXISTS games_by_event ON games(event COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS game_sources_by_collection
  ON game_sources(source, collection, game_id);
CREATE INDEX IF NOT EXISTS game_sources_by_game
  ON game_sources(game_id, source, collection);
CREATE INDEX IF NOT EXISTS explorer_samples_by_top
  ON explorer_samples(
    position_id, database_id, month, rating_sum DESC, played_at DESC, sort_id DESC
  );
CREATE INDEX IF NOT EXISTS explorer_samples_by_recent
  ON explorer_samples(
    position_id, database_id, month, played_at DESC, sort_id DESC
  );
CREATE INDEX IF NOT EXISTS annotation_sets_by_source
  ON annotation_sets(source_record_id, kind);
CREATE INDEX IF NOT EXISTS annotations_by_anchor
  ON annotations(annotation_set_id, anchor_ply, anchor_path, ordinal);
CREATE INDEX IF NOT EXISTS source_tree_nodes_by_parent
  ON source_tree_nodes(source_record_id, parent_id, child_order);
