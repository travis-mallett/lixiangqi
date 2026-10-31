"""Move the directory into the games catalog with application writers stopped.

The immutable, checksummed BSON backup contains every original document and
collection index. Follows and account references are untouched. A retry after
interruption always reads the backup, never partially migrated source records.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path

from bson import BSON, decode_all, json_util
from pymongo import MongoClient

from tools.games_database import players

MIGRATION = 'player-catalog-v1'
COLLECTIONS = ('directory_player', 'directory_player_rating', 'directory_federation')


def durable_write(path: Path, payload: bytes) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('wb') as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def convert(doc: dict, ratings: dict) -> dict:
    profile = {k: v for k, v in doc.items() if k not in ('_id', 'token', 'tokens')}
    profile['id'] = doc['_id']
    profile['ratingsHistory'] = {k: v for k, v in ratings.get(doc['_id'], {}).items() if k != '_id'}
    if 'titles' not in profile:
        profile['titles'] = ([dict(issuer='WXF' if profile['title'].startswith('I') else 'CXA',
                                  code=profile['title'], label=profile['title'], status='recorded',
                                  source=profile['provenance'])] if profile.get('title') else [])
    return players.validate_profile(profile)


def migrate(mongo, catalog, backup: Path, *, writers_stopped: bool) -> dict:
    if not writers_stopped:
        raise ValueError('Stop application writers before migrating player profiles')
    backup = backup.resolve()
    backup.mkdir(parents=True, exist_ok=True)
    players.initialize(catalog)
    catalog.execute('CREATE TABLE IF NOT EXISTS player_migrations(id TEXT PRIMARY KEY, backup TEXT NOT NULL)')
    catalog.commit()
    marker = catalog.execute('SELECT backup FROM player_migrations WHERE id=?', (MIGRATION,)).fetchone()
    if marker:
        # Deletion may have been interrupted after the SQLite transaction committed.
        backup = Path(marker[0])
    manifest_path = backup / 'manifest.json'
    if not manifest_path.exists():
        if marker:
            raise ValueError('Player migration backup is missing')
        metadata, checksums = {}, {}
        for name in COLLECTIONS:
            docs = list(mongo[name].find())
            metadata[name] = {'count': len(docs), 'indexes': list(mongo[name].list_indexes())
                              if name in mongo.list_collection_names() else []}
            payload = b''.join(BSON.encode(doc) for doc in docs)
            durable_write(backup / (name + '.bson'), payload)
            checksums[name] = hashlib.sha256(payload).hexdigest()
        # Profile tables can already exist on an initialized or restored catalog.
        existing = list(catalog.execute('SELECT profile_json FROM players'))
        durable_write(backup / 'catalog-profiles.json',
                      json.dumps([json.loads(row[0]) for row in existing], ensure_ascii=False).encode())
        durable_write(manifest_path, json_util.dumps({'migration': MIGRATION,
            'collections': metadata, 'sha256': checksums}).encode())
    manifest = json_util.loads(manifest_path.read_text(encoding='utf-8'))
    originals = {}
    for name in COLLECTIONS:
        payload = (backup / (name + '.bson')).read_bytes()
        if hashlib.sha256(payload).hexdigest() != manifest['sha256'][name]:
            raise ValueError(f'Backup checksum mismatch: {name}')
        originals[name] = decode_all(payload)
        if len(originals[name]) != manifest['collections'][name]['count']:
            raise ValueError(f'Backup document count mismatch: {name}')
    ratings = {doc['_id']: doc for doc in originals['directory_player_rating']}
    profiles = [convert(doc, ratings) for doc in originals['directory_player']]
    if len({p['id'] for p in profiles}) != len(profiles):
        raise ValueError('Duplicate player identity')
    orphan_ratings = ratings.keys() - {p['id'] for p in profiles}
    if orphan_ratings:
        raise ValueError(f'Rating history has no profile: {sorted(orphan_ratings)}')
    if not marker:
        with catalog:
            expected = []
            for p in profiles:
                current = players.find(catalog, p['id'])
                if current:
                    current.pop('stats', None)
                    if current != p:
                        raise ValueError(f'Conflicting existing catalog profile: {p["id"]}')
                expected.append(players.upsert(catalog, p))
            players.refresh_stats(catalog)
            for p in expected:
                imported = players.find(catalog, p['id'])
                imported.pop('stats', None)
                if imported != p:
                    raise ValueError(f'Player verification failed: {p["id"]}')
            catalog.execute('INSERT INTO player_migrations VALUES (?, ?)', (MIGRATION, str(backup)))
    for name in COLLECTIONS:
        # Refuse to delete unexpected post-backup writes, even on recovery.
        live = list(mongo[name].find())
        if live and {d['_id']: d for d in live} != {d['_id']: d for d in originals[name]}:
            raise ValueError(f'{name} changed after backup; writers must remain stopped')
        mongo.drop_collection(name)
    return {'players': len(profiles), 'backup': str(backup), 'alreadyComplete': bool(marker)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mongo-uri', required=True)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--backups', type=Path, required=True)
    parser.add_argument('--writers-stopped', action='store_true')
    parser.add_argument('--check', action='store_true', help='Check readiness without migrating or removing Mongo data')
    args = parser.parse_args()
    with MongoClient(args.mongo_uri) as client, closing(players.connect(args.database)) as db:
        if args.check:
            mongo = client.get_default_database()
            if any(mongo[name].find_one() is not None for name in COLLECTIONS):
                raise SystemExit('Player directory migration is required. Stop writers and explicitly run '
                                 '20261026_player_catalog with --writers-stopped and a backup directory.')
            players.initialize(db)
            print('Player catalog is ready')
            return
        print(json.dumps(migrate(client.get_default_database(), db, args.backups / MIGRATION,
                                 writers_stopped=args.writers_stopped)))


if __name__ == '__main__':
    main()
