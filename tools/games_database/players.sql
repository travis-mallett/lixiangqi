-- Canonical player profiles. Games remain in games; aliases resolve the
-- original player spelling without copying a game into a directory database.
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  federation TEXT,
  title TEXT,
  profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
  stats_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(stats_json)),
  dirty INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS player_aliases (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  -- Only verified, unique native spellings link games. Romanizations are search
  -- aliases: two different Chinese names can have the same romanization.
  matches_games INTEGER NOT NULL DEFAULT 0 CHECK (matches_games IN (0, 1)),
  PRIMARY KEY (player_id, name)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS player_aliases_by_name ON player_aliases(name, matches_games);
CREATE INDEX IF NOT EXISTS players_by_name ON players(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS players_by_federation ON players(federation);

-- Source identities and pending matches share the catalog; no second profile store.
CREATE TABLE IF NOT EXISTS player_sources (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  player_id TEXT REFERENCES players(id),
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  status TEXT NOT NULL CHECK (status IN ('matched', 'review', 'ignored')),
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (provider, external_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS player_sources_by_player ON player_sources(player_id);
CREATE INDEX IF NOT EXISTS player_sources_unresolved_names
ON player_sources(json_extract(record_json,'$.nativeName')) WHERE status='review';
CREATE TABLE IF NOT EXISTS player_import_runs (
  id TEXT PRIMARY KEY,
  finished_at TEXT NOT NULL,
  report_json TEXT NOT NULL CHECK (json_valid(report_json))
);
-- Reviewed identity overrides take precedence over name matching for one game side.
-- A NULL player explicitly leaves an ambiguous side unresolved.
CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  color TEXT NOT NULL CHECK (color IN ('red', 'black')),
  player_id TEXT REFERENCES players(id),
  source_url TEXT NOT NULL,
  PRIMARY KEY (game_id, color)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS game_players_by_player ON game_players(player_id, game_id);
CREATE TRIGGER IF NOT EXISTS game_player_insert AFTER INSERT ON game_players BEGIN
  UPDATE players SET dirty=1 WHERE id=new.player_id OR id IN (
    SELECT a.player_id FROM player_aliases a JOIN games g ON g.id=new.game_id
    WHERE a.name=CASE new.color WHEN 'red' THEN g.red_name ELSE g.black_name END
  );
END;
CREATE TRIGGER IF NOT EXISTS game_player_delete AFTER DELETE ON game_players BEGIN
  UPDATE players SET dirty=1 WHERE id=old.player_id OR id IN (
    SELECT a.player_id FROM player_aliases a JOIN games g ON g.id=old.game_id
    WHERE a.name=CASE old.color WHEN 'red' THEN g.red_name ELSE g.black_name END
  );
END;
CREATE TRIGGER IF NOT EXISTS game_player_update AFTER UPDATE ON game_players BEGIN
  UPDATE players SET dirty=1 WHERE id=old.player_id OR id=new.player_id OR id IN (
    SELECT a.player_id FROM player_aliases a JOIN games g ON g.id=new.game_id
    WHERE a.name=CASE new.color WHEN 'red' THEN g.red_name ELSE g.black_name END
  );
END;

CREATE TRIGGER IF NOT EXISTS player_stats_insert AFTER INSERT ON games BEGIN
  UPDATE players SET dirty = 1 WHERE id IN (
    SELECT player_id FROM player_aliases WHERE matches_games = 1
    AND name IN (new.red_name, new.black_name)
  );
END;
CREATE TRIGGER IF NOT EXISTS player_stats_delete AFTER DELETE ON games BEGIN
  UPDATE players SET dirty = 1 WHERE id IN (
    SELECT player_id FROM player_aliases WHERE matches_games = 1
    AND name IN (old.red_name, old.black_name)
  );
END;
CREATE TRIGGER IF NOT EXISTS player_stats_update
AFTER UPDATE OF red_name, black_name, result, played_at, event, red_team, black_team,
  record_kind, statistical_eligible ON games BEGIN
  UPDATE players SET dirty = 1 WHERE id IN (SELECT player_id FROM game_players WHERE game_id=new.id) OR id IN (
    SELECT player_id FROM player_aliases WHERE matches_games = 1
    AND name IN (new.red_name, new.black_name, old.red_name, old.black_name)
  );
END;
