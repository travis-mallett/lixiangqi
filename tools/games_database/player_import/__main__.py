"""Import official titles and Xiangqiqipu profiles into the canonical games DB."""
from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from .. import players
from ..storage import compact_json, database_path
from .fetch import Fetcher
from . import sources
from .pipeline import apply_records, apply_edits, coverage


def collect(fetcher, selected):
    records = []
    refresh_days = fetcher.refresh_days
    fetcher.refresh_days = min(7, refresh_days)
    if 'wxf' in selected:
        data, _ = fetcher.get(sources.WXF_PAGE)
        url, date = sources.wxf_publication(data)
        data, evidence = fetcher.get(url)
        records += sources.wxf(sources.pdf_text(data), sources.publication('wxf', url, date, evidence))
        print(f'Parsed {len(records)} WXF players', flush=True)
    if 'cxa' in selected:
        data, _ = fetcher.get(sources.CXA_PAGE)
        date = re.search(r'发布时间.*?(20\d\d-\d\d-\d\d)', data.decode('utf-8'), re.S)
        if not date:
            raise ValueError('Missing CXA publication date')
        data, evidence = fetcher.get(sources.CXA_PDF)
        rows = sources.cxa(sources.pdf_text(data), sources.publication('cxa', sources.CXA_PDF, date[1], evidence))
        records += rows
        print(f'Parsed {len(rows)} CXA registered players', flush=True)
        for date, url, names in sources.TITLE_NOTICES:
            data, evidence = fetcher.get(url)
            records += sources.title_notice(data, sources.publication('cxa-notice', url, date, evidence), names)
    if 'xiangqiqipu' in selected:
        fetcher.refresh_days = refresh_days
        data, index_evidence = fetcher.get(sources.QIPU_PAGE)
        directory = sources.qipu_directory(data)
        for i, record in enumerate(directory):
            record['directorySource'] = sources.publication('xiangqiqipu', sources.QIPU_PAGE, 'undated', index_evidence)
            data, evidence = fetcher.get(record['profileUrl'])
            pub = sources.publication('xiangqiqipu', record['profileUrl'], 'undated', evidence)
            records.append(sources.qipu_profile(data, record, pub))
            if (i+1) % 25 == 0 or i+1 == len(directory):
                print(f'Parsed Xiangqiqipu profiles {i+1}/{len(directory)}', flush=True)
    return records


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=database_path())
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--sources', default='wxf,cxa,xiangqiqipu')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--refresh-days', type=int, default=30)
    parser.add_argument('--delay', type=float, default=1.0)
    parser.add_argument('--apply', action='store_true', help='Commit; otherwise all catalog changes roll back')
    parser.add_argument('--decisions', type=Path, help='Reviewed source-key → canonical ID, new, or ignore JSON')
    parser.add_argument('--edits', type=Path, help='Reviewed canonical fields and per-game identity links JSON')
    parser.add_argument('--input', type=Path, help='Import an already fetched, normalized batch without network access')
    args = parser.parse_args(argv)
    if not args.database.is_file():
        parser.error('An existing canonical games database is required')
    selected = args.sources.split(',')
    if set(selected) - {'wxf', 'cxa', 'xiangqiqipu', 'none'} or args.delay < 0 or args.refresh_days < 0:
        parser.error('Invalid source or refresh settings')
    directory = args.database.parent / 'player-import'
    directory.mkdir(exist_ok=True)
    fetcher = Fetcher(args.cache or directory / 'cache', offline=args.offline,
                      refresh_days=args.refresh_days, delay=args.delay)
    records = (json.loads(args.input.read_text(encoding='utf-8')) if args.input else
               collect(fetcher, selected))  # Complete parsing before any writes.
    publications = []
    if not args.input and 'cxa' in selected:
        fetcher.refresh_days = min(7, args.refresh_days)
        data, _ = fetcher.get(sources.CXA_NOTICES)
        publications = sources.discover_publications(data)
    decisions = json.loads(args.decisions.read_text(encoding='utf-8')) if args.decisions else {}
    edits = json.loads(args.edits.read_text(encoding='utf-8')) if args.edits else {}
    with closing(players.connect(args.database)) as db:
        players.initialize(db)
        db.execute('BEGIN IMMEDIATE')
        try:
            report = apply_records(db, records, decisions)
            apply_edits(db, edits.get('players', {}), edits.get('gameLinks', []))
            report['statsRefreshed'] = players.refresh_stats(db)
            report['coverage'] = coverage(db)
            report['committed'] = args.apply
            report['finishedAt'] = datetime.now(timezone.utc).isoformat()
            report['database'] = str(args.database.resolve())
            report['sources'] = selected
            report['publicationsForReview'] = publications
            if args.apply:
                db.execute('INSERT INTO player_import_runs VALUES(?,?,?)',
                           (uuid.uuid4().hex, report['finishedAt'], compact_json(report)))
                db.commit()
            else:
                db.rollback()
        except BaseException:
            db.rollback()
            raise
    path = args.report or directory / ('latest-import.json' if args.apply else 'dry-run.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('identityReview','fieldConflicts')}, ensure_ascii=False, indent=2))
    print(f'Report: {path}')
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
