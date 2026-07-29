PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- Discovery workers claim source references, never copied game records.
CREATE TABLE IF NOT EXISTS game_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discovery_version TEXT NOT NULL,
  source_database TEXT NOT NULL,
  game_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'complete', 'retry', 'rejected', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claimed_at TEXT,
  next_attempt_at TEXT,
  diagnostic TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (discovery_version, source_database, game_id)
);

-- Cache keys include source history, engine identity, and settings. Repeated
-- FENs with different repetition histories therefore do not alias.
CREATE TABLE IF NOT EXISTS analysis_cache (
  context_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  nnue TEXT NOT NULL,
  settings_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (context_hash, engine_version, nnue, settings_hash)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_key TEXT NOT NULL UNIQUE,
  source_database TEXT NOT NULL,
  game_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  ply INTEGER NOT NULL CHECK (ply > 0),
  side_to_move TEXT NOT NULL CHECK (side_to_move IN ('red', 'black')),
  pre_fen TEXT NOT NULL,
  position_fen TEXT NOT NULL,
  position_hash TEXT NOT NULL,
  played_move TEXT NOT NULL,
  best_move TEXT NOT NULL,
  before_score_json TEXT NOT NULL,
  after_score_json TEXT NOT NULL,
  evaluation_loss REAL NOT NULL,
  candidate_type TEXT NOT NULL
    CHECK (candidate_type IN ('checkmate_candidate', 'tactic_candidate')),
  engine_version TEXT NOT NULL,
  nnue TEXT NOT NULL,
  search_settings_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'processing', 'published', 'untagged', 'review',
      'retry', 'rejected', 'failed'
    )),
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claimed_at TEXT,
  next_attempt_at TEXT,
  diagnostic TEXT NOT NULL DEFAULT '',
  solution_json TEXT,
  solution_plies INTEGER,
  branches_json TEXT,
  themes_json TEXT,
  verified_engine_version TEXT,
  verified_nnue TEXT,
  categorization_settings_json TEXT,
  categorization_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS puzzles (
  id TEXT PRIMARY KEY,
  candidate_id INTEGER NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  fen TEXT NOT NULL,
  display_fen TEXT NOT NULL,
  initial_ply INTEGER NOT NULL,
  line TEXT NOT NULL,
  solution TEXT NOT NULL,
  solution_plies INTEGER NOT NULL,
  mate_in INTEGER NOT NULL,
  rating REAL NOT NULL DEFAULT 1500,
  rating_deviation REAL NOT NULL DEFAULT 350,
  plays INTEGER NOT NULL DEFAULT 0,
  vote REAL NOT NULL DEFAULT 1,
  themes TEXT NOT NULL,
  engine TEXT NOT NULL,
  nnue TEXT NOT NULL,
  engine_nodes INTEGER NOT NULL,
  engine_depth INTEGER NOT NULL,
  generator_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS game_jobs_by_status
  ON game_jobs(discovery_version, status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS candidates_by_status
  ON candidates(candidate_type, categorization_version, status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS candidates_by_position
  ON candidates(position_hash);
CREATE INDEX IF NOT EXISTS puzzles_by_theme
  ON puzzles(created_at, id);
