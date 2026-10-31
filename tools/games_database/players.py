"""Canonical player profiles and exact, ambiguity-safe catalog identity links.

The Scala directory is a client of this repository. Profile imports never own
games, follows, or website accounts. Original source publications remain in the
profile's provenance; editor-owned fields survive a roster refresh.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .storage import compact_json, database_path

SCHEMA = Path(__file__).with_suffix('.sql')
ENRICHMENT = Path(__file__).with_name('player_enrichment.json')
ID = re.compile(r'[a-z][a-z0-9-]{1,15}:[A-Za-z0-9._-]{1,80}')
TITLES = {'IGM', 'IM', 'IFM', 'GM', 'NM'}
TITLE_ORDER = ('IGM', 'GM', 'IM', 'NM', 'IFM')
EDITOR_FIELDS = ('photo', 'biography', 'biographySources', 'deceasedYear', 'team', 'teamAsOf', 'gameNames')


def connect(path: Path | None = None) -> sqlite3.Connection:
    db = sqlite3.connect(path or database_path(), timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')
    return db


def initialize(db: sqlite3.Connection) -> None:
    if any(row[1] == 'professional' for row in db.execute('PRAGMA table_info(players)')):
        raise ValueError('Run tools.data_migration.20261026_player_registry with a backup before upgrading players')
    db.executescript(SCHEMA.read_text(encoding='utf-8'))


def text(value: Any, limit: int = 200) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError('Invalid player text')
    return value.strip()


def source_url(value: Any) -> str:
    value = text(value, 2000)
    url = urlsplit(value)
    if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password:
        raise ValueError('A public HTTP source URL is required')
    return value


def validate_publication(value: Any) -> None:
    if not isinstance(value, dict):
        raise ValueError('A source publication is required')
    source_url(value.get('url'))
    text(value.get('provider'), 80)
    text(value.get('publishedAt'), 40)


def validate_profile(profile: dict) -> dict:
    if not isinstance(profile, dict):
        raise ValueError('Player must be an object')
    p = dict(profile)
    if not isinstance(p.get('aliases', []), list):
        raise ValueError('Aliases must be a list')
    if not ID.fullmatch(text(p.get('id'), 100)):
        raise ValueError('Invalid player ID')
    p['name'] = text(p.get('name'))
    p['aliases'] = list(dict.fromkeys(text(n) for n in p.get('aliases', [])))
    if len(p['aliases']) > 50:
        raise ValueError('Too many aliases')
    if p.get('title') and p['title'] not in TITLES:
        raise ValueError('Invalid Xiangqi title')
    if not isinstance(p.get('titles'), list):
        raise ValueError('Titles must be a list')
    for award in p.get('titles', []):
        if award.get('code') not in TITLES | {'CAM', 'LM'} or award.get('issuer') not in ('WXF', 'CXA'):
            raise ValueError('Invalid title issuer or code')
        if award.get('status') not in ('recorded', 'revoked'):
            raise ValueError('Invalid title status')
        validate_publication(award.get('source'))
        if award['status'] == 'revoked':
            validate_publication(award.get('statusSource'))
    # title is an indexed display projection, never an independently editable fact.
    if 'titles' in p:
        qualifying = {a['code'] for a in p['titles'] if a['status'] == 'recorded'}
        p['title'] = next((t for t in TITLE_ORDER if t in qualifying), None)
    p.pop('professional', None)
    for key in ('provenance', 'ratingSources', 'biography'):
        if p.get(key) is not None and not isinstance(p[key], dict):
            raise ValueError(f'{key} must be an object')
    if p.get('gameNames') is not None:
        if not isinstance(p['gameNames'], list) or len(p['gameNames']) > 50:
            raise ValueError('Invalid game names')
        p['gameNames'] = [text(n) for n in p['gameNames']]
    for key in ('team', 'teamAsOf'):
        if p.get(key) is not None:
            text(p[key])
    validate_publication(p.get('provenance'))
    rating_sources = p.get('ratingSources') or {}
    p['ratingSources'] = rating_sources
    for publication in rating_sources.values():
        validate_publication(publication)
    for category in ('standard', 'rapid', 'blitz'):
        if p.get(category) is not None:
            if not isinstance(p[category], int) or not 1 <= p[category] <= 5000:
                raise ValueError('Invalid rating')
            validate_publication(rating_sources.get(category))
    for key in ('year', 'deceasedYear'):
        if p.get(key) is not None and (not isinstance(p[key], int) or not 1000 <= p[key] <= 2200):
            raise ValueError('Invalid year')
    if p.get('gender') not in (None, 'M', 'F'):
        raise ValueError('Invalid gender')
    if p.get('fed'):
        text(p['fed'], 8)
    if p.get('photo'):
        photo = p['photo']
        if not isinstance(photo, dict):
            raise ValueError('Photo must be an object')
        if photo.get('id'):
            text(photo['id'], 200)
        elif photo.get('url'):
            source_url(photo['url'])
            source_url(photo.get('sourceUrl'))
            text(photo.get('credit'), 500)
            text(photo.get('license'), 500)
        else:
            raise ValueError('Photo must have an image ID or a sourced image URL')
        if photo.get('sourceUrl'):
            source_url(photo['sourceUrl'])
        if photo.get('licenseUrl'):
            source_url(photo['licenseUrl'])
    if p.get('biography'):
        for locale, biography in p['biography'].items():
            if not re.fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]+)*', locale):
                raise ValueError('Invalid biography language')
            text(biography, 6000)
        if not p.get('biographySources'):
            raise ValueError('A biography must identify its sources')
    if not isinstance(p.get('biographySources', []), list):
        raise ValueError('Biography sources must be a list')
    for url in p.get('biographySources', []):
        source_url(url)
    return p


def upsert(db: sqlite3.Connection, profile: dict) -> dict:
    p = validate_profile(profile)
    old = db.execute('SELECT profile_json FROM players WHERE id = ?', (p['id'],)).fetchone()
    if not old:
        seed = json.loads(ENRICHMENT.read_text(encoding='utf-8')).get(p['id'])
        if seed and seed['nativeName'] in p['aliases']:
            for key, value in seed['fields'].items():
                if key not in p:
                    p[key] = value
            p = validate_profile(p)
    encoded = compact_json(p)
    if old and old[0] == encoded:
        return p
    previous = json.loads(old[0]) if old else None
    identity_changed = previous is None or any(previous.get(k) != p.get(k) for k in ('name', 'aliases', 'gameNames'))
    db.execute('''INSERT INTO players(id, name, federation, title, profile_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, federation=excluded.federation, title=excluded.title,
        profile_json=excluded.profile_json,
        dirty=max(players.dirty,?), updated_at=excluded.updated_at''',
        (p['id'], p['name'], p.get('fed'), p.get('title'), encoded, datetime.now(timezone.utc).isoformat(),
         int(identity_changed)))
    if not identity_changed:
        return p
    # Removing an ambiguous alias also changes the other player's statistics.
    db.execute('''UPDATE players SET dirty=1 WHERE id IN (
        SELECT a.player_id FROM player_aliases a JOIN player_aliases b ON a.name=b.name
        WHERE b.player_id=?)''', (p['id'],))
    db.execute('DELETE FROM player_aliases WHERE player_id = ?', (p['id'],))
    # WXF supplies native names as aliases. Explicit gameNames support reviewed
    # transliterations and homonyms without widening all searches to pinyin.
    game_names = p.get('gameNames', [n for n in p['aliases'] if re.search(r'[\u3400-\u9fff]', n)])
    if not game_names and 'gameNames' not in p:
        game_names = [p['name']]
    names = {name.casefold(): name for name in [p['name'], *p['aliases'], *game_names]}
    game_name_keys = {name.casefold() for name in game_names}
    for key, name in names.items():
        db.execute('INSERT INTO player_aliases VALUES (?, ?, ?)',
                   (p['id'], text(name), int(key in game_name_keys)))
    # Both players must be recomputed if a newly imported name is ambiguous.
    db.execute('''UPDATE players SET dirty=1 WHERE id IN (
        SELECT a.player_id FROM player_aliases a JOIN player_aliases b ON a.name=b.name
        WHERE b.player_id=?)''', (p['id'],))

    return p


def find(db: sqlite3.Connection, reference: str) -> dict | None:
    row = db.execute('SELECT profile_json, stats_json FROM players WHERE id=?', (reference,)).fetchone()
    if row is None:
        if db.execute("""SELECT 1 FROM player_sources WHERE status='review'
            AND json_extract(record_json,'$.nativeName')=? LIMIT 1""", (reference,)).fetchone():
            return None
        rows = db.execute('''SELECT p.profile_json, p.stats_json FROM players p
            JOIN player_aliases a ON a.player_id=p.id WHERE a.name=? LIMIT 2''', (reference,)).fetchall()
        if len(rows) != 1:
            return None
        row = rows[0]
    return {**json.loads(row[0]), 'stats': json.loads(row[1])}


def selection(player_id: str) -> tuple[str, list[str]]:
    return '''WITH names AS (
        SELECT a.name FROM player_aliases a WHERE a.player_id=? AND a.matches_games=1
        AND NOT EXISTS (SELECT 1 FROM player_aliases b
          WHERE b.name=a.name AND b.matches_games=1 AND b.player_id<>a.player_id)
        AND NOT EXISTS (SELECT 1 FROM player_sources ps WHERE ps.status='review'
          AND json_extract(ps.record_json,'$.nativeName')=a.name)
    ), matched_sides(id, player_color) AS (
        SELECT g.id, 'red' FROM names n JOIN games g ON g.red_name=n.name COLLATE NOCASE
        WHERE NOT EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id=g.id AND gp.color='red')
        UNION ALL
        SELECT g.id, 'black' FROM names n JOIN games g ON g.black_name=n.name COLLATE NOCASE
        WHERE NOT EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id=g.id AND gp.color='black')
        UNION ALL
        SELECT game_id, color FROM game_players WHERE player_id=?
    ), selected_games(id, player_color) AS MATERIALIZED (
        SELECT m.id, min(m.player_color) FROM matched_sides m JOIN games g ON g.id=m.id
        WHERE g.statistical_eligible=1 AND g.record_kind='played_game'
        GROUP BY m.id
    )''', [player_id, player_id]


def refresh_stats(db: sqlite3.Connection) -> int:
    # Indexed catalog queries run once per changed player, never per list view.
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')
    count = 0
    for row in db.execute('SELECT id FROM players WHERE dirty=1').fetchall():
        cte, parameters = selection(row[0])
        stats = db.execute(cte + ''' SELECT count(*) games,
            coalesce(sum((s.player_color='red' AND g.result=1) OR
                         (s.player_color='black' AND g.result=-1)),0) wins,
            coalesce(sum(g.result=0),0) draws, max(nullif(g.played_at,'')) lastPlayedAt
            FROM selected_games s JOIN games g ON g.id=s.id''', parameters).fetchone()
        team = db.execute(cte + ''' SELECT CASE s.player_color WHEN 'red' THEN g.red_team
            ELSE g.black_team END team, g.played_at FROM selected_games s JOIN games g ON g.id=s.id
            WHERE g.played_at<>'' AND (CASE s.player_color WHEN 'red' THEN g.red_team
            ELSE g.black_team END)<>'' ORDER BY g.played_at DESC, g.id LIMIT 1''', parameters).fetchone()
        payload = dict(stats)
        payload['losses'] = payload['games'] - payload['wins'] - payload['draws']
        if team:
            payload.update(team=team['team'], teamAsOf=team['played_at'])
        db.execute('UPDATE players SET stats_json=?, dirty=0 WHERE id=?', (compact_json(payload), row[0]))
        count += 1
    return count


def query(db: sqlite3.Connection, body: dict) -> dict:
    page, size = int(body.get('page', 1)), int(body.get('pageSize', 30))
    if not 1 <= page <= 10000 or not 1 <= size <= 100:
        raise ValueError('Invalid pagination')
    conditions, params = (['p.title IS NOT NULL'] if body.get('titledOnly', True) else ['1=1']), []
    search = str(body.get('search', '')).strip()
    if len(search) > 100:
        raise ValueError('Search is too long')
    if search:
        from external.xiangqi_explorer.name_romanization import normalized_name_key
        # Search presentation names without adding identity aliases or widening game matching.
        # The roster is small; cache transliteration across the existing substring scans.
        db.create_function('player_search_key', 1, player_search_key, deterministic=True)
        conditions.append('''EXISTS(SELECT 1 FROM player_aliases a WHERE a.player_id=p.id AND
            (instr(lower(a.name),lower(?))>0 OR (?<>'' AND instr(player_search_key(a.name),?)>0)))''')
        key = normalized_name_key(search)
        params.extend((search, key, key))
    if body.get('title'):
        conditions.append("EXISTS(SELECT 1 FROM json_each(p.profile_json,'$.titles') t WHERE json_extract(t.value,'$.code')=? AND json_extract(t.value,'$.status')='recorded')")
        params.append(body['title'])
    for field, column in (('federation', 'federation'),):
        if body.get(field):
            conditions.append(f'{column}=?')
            params.append(body[field])
    if body.get('ids') is not None:
        ids = body['ids']
        if not isinstance(ids, list) or len(ids) > 10000:
            raise ValueError('Invalid player IDs')
        conditions.append('p.id IN (' + ','.join('?' for _ in ids) + ')')
        params.extend(ids)
    where = ' AND '.join(conditions)
    orders = {'name': 'p.name COLLATE NOCASE', 'games': "coalesce(json_extract(stats_json,'$.games'),0) DESC",
              'score': "(json_extract(stats_json,'$.wins') + 0.5 * json_extract(stats_json,'$.draws')) / nullif(json_extract(stats_json,'$.games'),0) DESC",
              'standard': "json_extract(profile_json,'$.standard') DESC",
              'rapid': "json_extract(profile_json,'$.rapid') DESC", 'blitz': "json_extract(profile_json,'$.blitz') DESC",
              'year': "json_extract(profile_json,'$.year') DESC"}
    order = orders.get(body.get('order', 'games'))
    if order is None:
        raise ValueError('Invalid player order')
    total = db.execute(f'SELECT count(*) FROM players p WHERE {where}', params).fetchone()[0]
    rows = db.execute(f'SELECT profile_json, stats_json FROM players p WHERE {where} ORDER BY {order}, p.id LIMIT ? OFFSET ?',
                      [*params, size, (page-1)*size]).fetchall()
    return {'total': total, 'page': page, 'pageSize': size,
            'players': [{**json.loads(r[0]), 'stats': json.loads(r[1])} for r in rows]}


@lru_cache(maxsize=16_384)
def player_search_key(name: str) -> str:
    from external.xiangqi_explorer.name_romanization import name_forms, normalized_name_key
    return normalized_name_key(name_forms(name).display)
