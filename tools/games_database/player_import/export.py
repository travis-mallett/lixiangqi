"""Export deployment data from the canonical database, never from source fixtures."""
import argparse
import json
import sqlite3
from pathlib import Path

from ..storage import database_path
from .pipeline import canonical_id


def export(db, destination):
    records, decisions, edits, anchors, matched = [], {}, {}, set(), set()
    for provider, external_id, player_id, raw, status in db.execute(
        'SELECT provider, external_id, player_id, record_json, status FROM player_sources ORDER BY provider, external_id'
    ):
        record = json.loads(raw)
        anchor = status == 'matched' and canonical_id(record) == player_id
        records.append((not anchor, record))
        if status == 'matched':
            matched.add(player_id)
            if anchor:
                anchors.add(player_id)
            decisions[provider + ':' + external_id] = 'new' if anchor else player_id
        else:
            decisions[provider + ':' + external_id] = 'ignore' if status == 'ignored' else 'review'
    if matched - anchors:
        raise ValueError('Cannot bootstrap reviewed identities without their original source anchor')
    records = [record for _, record in sorted(records, key=lambda item: item[0])]
    for identifier, raw in db.execute('SELECT id, profile_json FROM players ORDER BY id'):
        profile = json.loads(raw)
        if photo := profile.get('photo'):
            edits[identifier] = {'changes': {'photo': photo}, 'onlyIfMissing': ['photo']}
    if not records:
        raise ValueError('The canonical player database has not been populated')
    destination.mkdir(parents=True, exist_ok=True)
    for name, value in [('initial.json', records), ('portraits.json', {'players': edits}),
                        ('decisions.json', decisions)]:
        (destination / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'records': len(records), 'portraits': len(edits)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=database_path())
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    with sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True) as db:
        print(json.dumps(export(db, args.destination)))


if __name__ == '__main__':
    main()
