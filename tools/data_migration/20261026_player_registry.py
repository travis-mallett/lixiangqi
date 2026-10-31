"""Back up and migrate the catalog's player tables; never rewrite game rows."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from tools.games_database import players


def migrate(db, backups: Path, *, writers_stopped: bool):
    if not writers_stopped:
        raise ValueError('Stop application writers before migrating player registry')
    columns = [r[1] for r in db.execute('PRAGMA table_info(players)')]
    if 'professional' not in columns:
        players.initialize(db)
        return {'alreadyCurrent': True}
    db.execute('BEGIN IMMEDIATE')
    try:
        # Only player tables are changed. Preserve their complete rows and DDL,
        # including aliases and cached stats, without copying the 6+ GB game store.
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'player_%'")]
        tables = list(dict.fromkeys(['players', *tables]))
        snapshot = {'createdAt': datetime.now(timezone.utc).isoformat(), 'tables': {}}
        for name in tables:
            ddl = db.execute('SELECT sql FROM sqlite_master WHERE name=?', (name,)).fetchone()[0]
            snapshot['tables'][name] = {'ddl': ddl, 'columns':[r[1] for r in db.execute(f'PRAGMA table_info("{name}")')],
                                        'rows':[list(r) for r in db.execute(f'SELECT * FROM "{name}"')]}
        snapshot['objects'] = [r[0] for r in db.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('trigger','index') AND (name LIKE 'player_%' OR name LIKE 'players_%')")]
        data = json.dumps(snapshot, ensure_ascii=False, indent=2).encode('utf-8')
        digest = hashlib.sha256(data).hexdigest()
        backups.mkdir(parents=True, exist_ok=True)
        destination = backups / ('player-registry-' + digest[:16] + '.json')
        with destination.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        destination.with_suffix('.sha256').write_text(digest, encoding='ascii')
        if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
            raise ValueError('Player backup verification failed')
        db.execute('ALTER TABLE players DROP COLUMN professional')
        for name in ('player_stats_insert', 'player_stats_delete', 'player_stats_update'):
            db.execute(f'DROP TRIGGER IF EXISTS {name}')
        for row in db.execute('SELECT id, profile_json FROM players').fetchall():
            p = json.loads(row[1])
            p.pop('professional', None)
            p['titles'] = ([dict(issuer='WXF' if p['title'].startswith('I') else 'CXA', code=p['title'],
                                 label=p['title'], status='recorded', source=p['provenance'])] if p.get('title') else [])
            players.upsert(db, p)
        if db.execute('SELECT count(*) FROM players').fetchone()[0] != len(snapshot['tables']['players']['rows']):
            raise ValueError('Player count changed during migration')
        db.commit()
    except BaseException:
        db.rollback()
        raise
    players.initialize(db)
    return {'players':len(snapshot['tables']['players']['rows']), 'backup':str(destination), 'sha256':digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--backups', required=True, type=Path)
    parser.add_argument('--writers-stopped', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error('Canonical games database does not exist')
    with closing(players.connect(args.database)) as db:
        if args.check:
            players.initialize(db)
            print('Player registry is ready')
            return
        print(json.dumps(migrate(db, args.backups, writers_stopped=args.writers_stopped)))


if __name__ == '__main__':
    main()
