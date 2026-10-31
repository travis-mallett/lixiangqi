"""Player repository HTTP operations shared by the directory and catalog UI."""

from __future__ import annotations

from contextlib import closing

from tools.games_database import players
from .catalog_databases import open_catalog_connection
from .name_romanization import name_forms


def display_profile(profile: dict | None) -> dict | None:
    if profile is None:
        return None
    # Names belong to the source publication; transliteration is presentation,
    # never an identity alias (different people can share the same pinyin).
    return {**profile, 'displayName': name_forms(profile['name']).display}


def read(body: dict) -> dict:
    db = open_catalog_connection()
    if db is None:
        raise RuntimeError('Games database is unavailable')
    with closing(db):
        action = body.get('action', 'list')
        if action == 'get':
            return {'player': display_profile(players.find(db, players.text(body.get('id'), 100)))}
        if action == 'batch':
            ids = body.get('ids', [])
            if not isinstance(ids, list) or len(ids) > 1000:
                raise ValueError('Invalid player IDs')
            return {'players': [display_profile(p) for ref in ids if (p := players.find(db, players.text(ref, 100)))]}
        if action == 'federations':
            rows = db.execute('''SELECT federation id, count(*) nbPlayers FROM players
                WHERE federation IS NOT NULL AND title IS NOT NULL GROUP BY federation ORDER BY nbPlayers DESC''')
            federations = {row['id']: dict(row) for row in rows}
            for category in ('standard', 'rapid', 'blitz'):
                ratings = db.execute(f'''WITH rated AS (
                    SELECT federation, json_extract(profile_json,'$.{category}') rating,
                    row_number() OVER(PARTITION BY federation ORDER BY json_extract(profile_json,'$.{category}') DESC) position
                    FROM players WHERE title IS NOT NULL AND federation IS NOT NULL
                    AND json_extract(profile_json,'$.{category}')>0)
                    SELECT federation, count(*) nbPlayers,
                    cast(round(avg(CASE WHEN position<=10 THEN rating END)) AS INTEGER) top10Rating
                    FROM rated GROUP BY federation ORDER BY top10Rating DESC, federation''').fetchall()
                for rank, row in enumerate(ratings, 1):
                    federations[row['federation']][category] = {
                        'rank': rank, 'nbPlayers': row['nbPlayers'], 'top10Rating': row['top10Rating']}
            return {'federations': list(federations.values())}
        if action != 'list':
            raise ValueError('Unknown player query')
        result = players.query(db, body)
        result['players'] = [display_profile(p) for p in result['players']]
        return result


def write(body: dict) -> dict:
    with closing(players.connect()) as db, db:
        action = body.get('action')
        if action == 'edit':
            profile = players.find(db, players.text(body.get('id'), 100))
            if profile is None:
                raise ValueError('Unknown player')
            changes = body.get('changes', {})
            if not isinstance(changes, dict) or set(changes) - set(players.EDITOR_FIELDS):
                raise ValueError('Unsupported profile fields')
            profile.pop('stats', None)
            profile.update(changes)
            profile['editorFields'] = sorted(set(profile.get('editorFields', [])) | set(changes))
            players.upsert(db, profile)
        else:
            raise ValueError('Unknown player write')
        changed = players.refresh_stats(db)
    return {'ok': True, 'updated': changed}
