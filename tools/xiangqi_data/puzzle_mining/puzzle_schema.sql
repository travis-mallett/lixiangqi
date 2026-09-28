PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- Immutable native user-game payloads.  The origin is part of the key so two
-- LiXiangQi installations may legitimately use the same game ID.
CREATE TABLE IF NOT EXISTS native_games (
  source_database TEXT NOT NULL,
  origin TEXT NOT NULL,
  game_id TEXT NOT NULL,
  initial_fen TEXT NOT NULL DEFAULT '',
  moves_json TEXT NOT NULL,
  players_json TEXT NOT NULL DEFAULT '{}',
  source_url TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  payload_checksum TEXT NOT NULL,
  snapshot_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_database, game_id),
  UNIQUE (payload_checksum)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS source_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  manifest_digest TEXT NOT NULL,
  created_at TEXT NOT NULL
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
  current_verification_id INTEGER REFERENCES candidate_assessments(id),
  current_classification_id INTEGER REFERENCES taxonomy_assessments(id),
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
  themes_json TEXT,
  verified_engine_version TEXT,
  verified_nnue TEXT,
  verification_settings_json TEXT,
  verifier_version TEXT,
  discovery_revision TEXT NOT NULL DEFAULT 'legacy',
  categorized_revision TEXT,
  attempt_theme_versions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every discovery result and every verification is retained.  The candidate
-- row is the stable identity and latest work item; these tables are the
-- recovery ledger; current candidate pointers are the only assessment authority.
CREATE TABLE IF NOT EXISTS candidate_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  revision_key TEXT NOT NULL,
  candidate_type TEXT NOT NULL,
  before_score_json TEXT NOT NULL,
  after_score_json TEXT NOT NULL,
  evaluation_loss REAL NOT NULL,
  engine_version TEXT NOT NULL,
  nnue TEXT NOT NULL,
  search_settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (candidate_id, revision_key)
);

CREATE TABLE IF NOT EXISTS candidate_assessments (
  verification_version TEXT,
  verification_signature TEXT,
  coverage TEXT NOT NULL DEFAULT 'legacy' CHECK (coverage IN ('legacy','complete','incomplete','invalid')),
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  revision_key TEXT NOT NULL,
  status TEXT NOT NULL,
  diagnostic TEXT NOT NULL DEFAULT '',
  solution_json TEXT,
  solution_plies INTEGER,
  branches_json TEXT,
  themes_json TEXT,
  verified_engine_version TEXT,
  verified_nnue TEXT,
  verification_settings_json TEXT,
  engine_nodes INTEGER,
  engine_depth INTEGER,
  accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
  created_at TEXT NOT NULL
);

-- One durable request per candidate/configuration. Classification has no input
-- into this queue; retries and leases do not change the current evidence.
CREATE TABLE IF NOT EXISTS verification_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claimed_at TEXT,
  next_attempt_at TEXT,
  diagnostic TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE(candidate_id, signature)
);
CREATE INDEX IF NOT EXISTS verification_jobs_by_status ON verification_jobs(status,next_attempt_at,id);

-- Taxonomy is derived from a verified trace and has its own lifecycle. It
-- never becomes the canonical verification evidence.
CREATE TABLE IF NOT EXISTS taxonomy_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  verification_assessment_id INTEGER NOT NULL REFERENCES candidate_assessments(id) ON DELETE CASCADE,
  taxonomy_version TEXT NOT NULL,
  status TEXT NOT NULL,
  diagnostic TEXT NOT NULL DEFAULT '',
  themes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(candidate_id, verification_assessment_id, taxonomy_version)
);

CREATE TABLE IF NOT EXISTS motif_removal_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  canonical_assessment_id INTEGER NOT NULL REFERENCES candidate_assessments(id) ON DELETE CASCADE,
  theme TEXT NOT NULL,
  theme_version TEXT NOT NULL,
  branch_index INTEGER NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(candidate_id, canonical_assessment_id, theme, theme_version, branch_index)
);

CREATE TABLE IF NOT EXISTS puzzles (
  id TEXT PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  fen TEXT NOT NULL,
  display_fen TEXT NOT NULL,
  initial_ply INTEGER NOT NULL,
  line TEXT NOT NULL,
  solution TEXT NOT NULL,
  solution_plies INTEGER NOT NULL,
  mate_in INTEGER,
  themes TEXT NOT NULL,
  engine TEXT NOT NULL,
  nnue TEXT NOT NULL,
  engine_nodes INTEGER NOT NULL,
  engine_depth INTEGER NOT NULL,
  generator_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'active'
    CHECK (verification_status IN ('active', 'withdrawn')),
  retired_at TEXT,
  retirement_reason TEXT,
  canonical_assessment_id INTEGER REFERENCES candidate_assessments(id),
  taxonomy_assessment_id INTEGER REFERENCES taxonomy_assessments(id),
  verification_signature TEXT
);

CREATE INDEX IF NOT EXISTS game_jobs_by_status
  ON game_jobs(discovery_version, status, next_attempt_at, id);
-- Keep native priority checks and expired-lease checks off the full catalog queue.
CREATE INDEX IF NOT EXISTS game_jobs_by_native_priority
  ON game_jobs(discovery_version, source_database COLLATE NOCASE, status, id);
CREATE INDEX IF NOT EXISTS game_jobs_by_lease
  ON game_jobs(status, claimed_at);
CREATE INDEX IF NOT EXISTS game_jobs_ready_order
  ON game_jobs(discovery_version, id) WHERE status IN ('queued', 'retry');
CREATE INDEX IF NOT EXISTS game_jobs_by_source_game
  ON game_jobs(source_database, game_id, status);
CREATE INDEX IF NOT EXISTS candidates_by_status
  ON candidates(candidate_type, verifier_version, status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS candidates_by_revision
  ON candidates(candidate_type, discovery_revision, categorized_revision, status, id);
CREATE INDEX IF NOT EXISTS candidate_revisions_by_candidate
  ON candidate_revisions(candidate_id, created_at, id);
CREATE INDEX IF NOT EXISTS candidate_assessments_by_candidate
  ON candidate_assessments(candidate_id, created_at, id);
CREATE INDEX IF NOT EXISTS taxonomy_assessments_by_candidate
  ON taxonomy_assessments(candidate_id, created_at, id);
-- One owner per playable root, independent of source history and move counters.
CREATE UNIQUE INDEX IF NOT EXISTS candidates_by_position
  ON candidates(position_hash);
CREATE INDEX IF NOT EXISTS puzzles_by_theme
  ON puzzles(created_at, id);
CREATE INDEX IF NOT EXISTS motif_removal_evidence_by_candidate
  ON motif_removal_evidence(candidate_id, canonical_assessment_id, theme, theme_version, branch_index);
CREATE INDEX IF NOT EXISTS puzzles_by_verification
  ON puzzles(verification_status, created_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS puzzles_one_active_per_candidate ON puzzles(candidate_id) WHERE verification_status='active';

-- Cover normal verification's historical-completion guard without loading proofs.
CREATE INDEX IF NOT EXISTS candidate_assessments_previously_verified
  ON candidate_assessments(candidate_id)
  WHERE accepted=1 OR coverage IN ('complete','invalid');

CREATE INDEX IF NOT EXISTS puzzles_by_candidate ON puzzles(candidate_id);

-- Durable full-game analysis, independent of the reusable position cache.
-- Compressed UTF-8 JSON contains the source moves, every position result,
-- engine/settings provenance, and run timing, including games with no candidates.
CREATE TABLE IF NOT EXISTS game_analyses (
  job_id INTEGER PRIMARY KEY REFERENCES game_jobs(id),
  payload_zlib BLOB NOT NULL,
  created_at TEXT NOT NULL,
  depth INTEGER
);

-- Pending automatic delivery only; the destination remains the authority on depth.
CREATE TABLE IF NOT EXISTS game_analysis_publications (
  origin TEXT NOT NULL,
  job_id INTEGER NOT NULL REFERENCES game_jobs(id),
  PRIMARY KEY(origin, job_id)
) WITHOUT ROWID;
