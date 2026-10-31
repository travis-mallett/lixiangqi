"""Idempotent source matching and field-level reconciliation in the games DB."""
from __future__ import annotations

import hashlib
import json
from collections import Counter

from .. import players
from ..storage import compact_json

FIELDS = ('name', 'gender', 'fed', 'year', 'birthDate', 'birthplace', 'team', 'teamAsOf',
          'biography', 'biographySources')
PRIORITY = {'wxf': 0, 'cxa': 1, 'xiangqiqipu': 2, 'cxa-notice': 3}


def canonical_id(record):
    if record['provider'] == 'wxf':
        return 'wxf:' + record['externalId']
    key = record['provider'] + ':' + record['externalId']
    return 'player:' + hashlib.sha256(key.encode()).hexdigest()[:24]


def reconcile(db, identifier, conflicts):
    previous = players.find(db, identifier)
    profile = dict(previous) if previous else {'id': identifier, 'aliases': [], 'titles': []}
    profile.pop('stats', None)
    records = [json.loads(r[0]) for r in db.execute(
        "SELECT record_json FROM player_sources WHERE player_id=? AND status='matched'", (identifier,))]
    records.sort(key=lambda r: (PRIORITY[r['provider']], r['externalId']))
    sources = profile.setdefault('fieldSources', {})
    locks = set(profile.get('editorFields', []))
    # Existing curated fields without an import owner are editorial, including
    # the licensed starter portrait and reviewed biographies.
    if previous and 'editorFields' not in previous:
        locks.update(k for k in FIELDS if previous.get(k) is not None and k not in sources)
    for field in FIELDS:
        candidates = [r for r in records if r.get(field) not in (None, '', {}, [])]
        if not candidates or field in locks:
            continue
        # Affiliations use their publication date, not the date we crawled them.
        if field in ('team', 'teamAsOf'):
            candidates.sort(key=lambda r: r.get('teamAsOf', ''), reverse=True)
        chosen = candidates[0]
        if field not in ('biography', 'biographySources', 'name', 'team', 'teamAsOf'):
            values = {compact_json(r[field]) for r in candidates}
            if len(values) > 1:
                conflicts.append(dict(playerId=identifier, field=field,
                                      candidates=[{'value':r[field], 'source':r['source']} for r in candidates]))
        profile[field] = chosen[field]
        sources[field] = chosen.get('fieldSources', {}).get(field, chosen['source'])
    profile['editorFields'] = sorted(locks)
    profile['provenance'] = records[0]['source']
    profile['aliases'] = list(dict.fromkeys([*profile['aliases'], *(r['nativeName'] for r in records),
                                           *(r['name'] for r in records if r['name'] != profile['name'])]))
    # A later publication supersedes status for the same issuer/title, but an
    # absent row never revokes an award or deletes a person.
    titles = {(a['issuer'], a['code']):a for a in profile.get('titles', [])}
    for record in records:
        for award in ([] if 'titles' in locks else record.get('titles', [])):
            key = award['issuer'], award['code']
            old = titles.get(key)
            if not old or (old['status'] != 'revoked' and old['source']['publishedAt'] <= award['source']['publishedAt']):
                titles[key] = award
    if 'titles' not in locks:
        for record in records:
            if change := record.get('titleStatus'):
                for key, award in list(titles.items()):
                    if award['issuer'] == change['issuer'] and award['source']['publishedAt'] <= record['source']['publishedAt']:
                        titles[key] = {**award, 'status':change['status'], 'statusSource':record['source']}
    profile['titles'] = sorted(titles.values(), key=lambda a: (a['issuer'], a['code']))
    profile['photoCandidates'] = [r['photoCandidate'] for r in records if r.get('photoCandidate')]
    # Preserve the deliberately licensed/editorial initial assets via normal upsert.
    return players.upsert(db, profile)


def apply_records(db, records, decisions=None):
    decisions = decisions or {}
    counts, issues, conflicts, touched = Counter(), [], [], set()
    keys = [(r['provider'], r['externalId']) for r in records]
    if len(set(keys)) != len(keys):
        raise ValueError('Duplicate source identity in import batch')
    for record in records:
        provider, external_id = record['provider'], record['externalId']
        if provider not in PRIORITY:
            raise ValueError('Unknown player provider')
        players.validate_publication(record['source'])
        players.text(record['nativeName'])
        counts[provider + 'Discovered'] += 1
        key = provider + ':' + external_id
        old = db.execute('SELECT player_id, status, reason, record_json FROM player_sources WHERE provider=? AND external_id=?',
                         (provider, external_id)).fetchone()
        if old and json.loads(old[3])['source'].get('observedAt','') > record['source'].get('observedAt',''):
            counts['olderSnapshotSkipped'] += 1
            continue
        identifier = old[0] if old else None
        if identifier is None and provider == 'wxf' and players.find(db, canonical_id(record)):
            identifier = canonical_id(record)
        status, reason = 'matched', old[2] if old else ''
        if decisions.get(key) == 'ignore' or (old and old[1] == 'ignored' and key not in decisions):
            status = 'ignored'
        elif decisions.get(key) == 'review':
            if old and old[0]:
                raise ValueError('Unmatching an existing identity requires a reviewed player merge')
            status, reason = 'review', 'reviewed-unresolved'
            issues.append(dict(source=key, name=record['nativeName'], candidates=[]))
        elif key in decisions:
            selected = decisions[key]
            identifier = canonical_id(record) if selected == 'new' else selected
            if selected != 'new' and not players.find(db, selected):
                raise ValueError(f'Review decision references unknown player: {selected}')
            if old and old[0] and old[0] != identifier:
                raise ValueError('Reassigning an already matched identity requires a reviewed player merge')
            reason = 'reviewed'
        elif identifier is None:
            candidates = db.execute('''SELECT DISTINCT p.id, p.profile_json FROM players p
                JOIN player_aliases a ON a.player_id=p.id WHERE a.name=?''', (record['nativeName'],)).fetchall()
            compatible = []
            for candidate in candidates:
                p = json.loads(candidate[1])
                agree = (p.get('gender') and record.get('gender') == p['gender']) or (
                    provider == 'cxa-notice' and any(a['issuer']=='CXA' for a in p.get('titles', [])))
                contradict = any(p.get(f) is not None and record.get(f) is not None and p[f] != record[f]
                                 for f in ('gender', 'year'))
                same_source = db.execute('''SELECT 1 FROM player_sources WHERE player_id=? AND provider=?
                    AND json_extract(record_json,'$.source.publishedAt')=?''',
                    (candidate[0], provider, record['source']['publishedAt'])).fetchone()
                # Multiple native-name entries in one publisher are never folded together.
                if agree and not contradict and not same_source:
                    compatible.append(candidate[0])
            if len(candidates) == 1 and len(compatible) == 1:
                identifier = compatible[0]
                reason = 'unique-native-name-and-gender'
            elif candidates or provider == 'cxa-notice':
                status, reason = 'review', 'ambiguous-or-conflicting-identity'
                issues.append(dict(source=key, name=record['nativeName'], candidates=[c[0] for c in candidates]))
            else:
                identifier = canonical_id(record)
                reason = 'new-source-identity'
        if status == 'matched' and not players.find(db, identifier):
            players.upsert(db, {'id': identifier, 'name': record['name'], 'aliases':[record['nativeName']],
                               'titles': [], 'provenance':record['source'],
                               'fieldSources': {'name': record['source']}})
            counts['created'] += 1
        db.execute('''INSERT INTO player_sources VALUES(?,?,?,?,?,?)
            ON CONFLICT(provider,external_id) DO UPDATE SET player_id=excluded.player_id,
            record_json=excluded.record_json, status=excluded.status, reason=excluded.reason''',
                   (provider, external_id, identifier, compact_json(record), status, reason))
        if (status == 'review' and (not old or old[1] != status)) or (old and old[1] == 'review' and status != 'review'):
            db.execute('''UPDATE players SET dirty=1 WHERE id IN
                (SELECT player_id FROM player_aliases WHERE name=?)''', (record['nativeName'],))
        counts[status] += 1
        if status == 'matched':
            reconcile(db, identifier, conflicts)
            touched.add(identifier)
    # Report unique conflicts (one player may have several incoming records).
    unique_conflicts = {compact_json(c):c for c in conflicts}
    return dict(counts= dict(counts), identityReview=issues, fieldConflicts=list(unique_conflicts.values()),
                touchedPlayers=len(touched))


def apply_edits(db, edits, game_links):
    allowed = set(FIELDS) | set(players.EDITOR_FIELDS) | {'titles', 'aliases'}
    for identifier, edit in edits.items():
        p = players.find(db, identifier)
        if not p:
            raise ValueError(f'Unknown player in reviewed edits: {identifier}')
        changes, unlock = edit.get('changes', {}), edit.get('unlock', [])
        only_missing = set(edit.get('onlyIfMissing', []))
        if set(changes) - allowed or set(unlock) - allowed or only_missing - set(changes):
            raise ValueError('Unsupported reviewed field')
        changes = {k:v for k,v in changes.items() if k not in only_missing or not p.get(k)}
        p.pop('stats', None)
        p.update(changes)
        p['editorFields'] = sorted((set(p.get('editorFields', [])) - set(unlock)) | set(changes))
        players.upsert(db, p)
    for link in game_links:
        game, color, player = link['gameId'], link['color'], link.get('playerId')
        if color not in ('red', 'black') or not db.execute('SELECT 1 FROM games WHERE id=?', (game,)).fetchone():
            raise ValueError('Unknown game or side in reviewed identity link')
        if player and not players.find(db, player):
            raise ValueError('Unknown player in reviewed identity link')
        url = players.source_url(link['sourceUrl'])
        db.execute('''INSERT INTO game_players VALUES(?,?,?,?) ON CONFLICT(game_id,color)
            DO UPDATE SET player_id=excluded.player_id, source_url=excluded.source_url''', (game,color,player,url))


def coverage(db):
    return dict(db.execute('''SELECT count(*) players, sum(title IS NOT NULL) titledPlayers,
        sum(json_extract(profile_json,'$.biography.en') IS NOT NULL) englishBiographies,
        sum(json_extract(profile_json,'$.biography.zh-CN') IS NOT NULL) chineseBiographies,
        sum(json_extract(profile_json,'$.photo') IS NOT NULL) publishedPhotos,
        sum(json_array_length(profile_json,'$.photoCandidates')>0) portraitCandidates,
        sum(coalesce(json_extract(stats_json,'$.games'),0)>0) playersWithGames
        FROM players''').fetchone())
