PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  canonical_hash BLOB NOT NULL,
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
  source_url TEXT NOT NULL,
  UNIQUE (source, external_id),
  UNIQUE (source, canonical_hash)
);

CREATE TABLE IF NOT EXISTS game_positions (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL,
  position_key TEXT NOT NULL,
  move TEXT NOT NULL,
  notation TEXT NOT NULL,
  PRIMARY KEY (game_id, ply)
) WITHOUT ROWID;

-- A canonical game may be published more than once, or appear in more than
-- one DPXQ collection. Keep every source record without duplicating the game
-- and its position index. ``collection`` is the stable DPXQ owner code (m, n,
-- t, k, o, b, u, or w); ``collection_name`` is the display label captured at
-- import time.
CREATE TABLE IF NOT EXISTS game_sources (
  source TEXT NOT NULL,
  collection TEXT NOT NULL,
  collection_name TEXT NOT NULL,
  external_id TEXT NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (source, collection, external_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS game_positions_by_position
  ON game_positions(position_key, game_id);
CREATE INDEX IF NOT EXISTS games_by_source_date
  ON games(source, month, played_at);
CREATE INDEX IF NOT EXISTS games_by_red
  ON games(source, red_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS games_by_black
  ON games(source, black_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS games_by_event
  ON games(source, event COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS game_sources_by_collection
  ON game_sources(source, collection, game_id);
CREATE INDEX IF NOT EXISTS game_sources_by_game
  ON game_sources(game_id, source, collection);
