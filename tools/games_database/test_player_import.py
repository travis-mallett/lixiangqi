import importlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from tools.games_database import players
from tools.games_database.player_import import pipeline, sources
from tools.games_database.player_import.export import export


def record(provider='wxf', external_id='IGM9000', name='测试甲', **fields):
    pub = dict(provider=provider, url='https://example.org/roster', publishedAt='2022-12-09')
    return dict(provider=provider, externalId=external_id, nativeName=name, name=name,
                gender='M', source=pub, **fields)


class ImportTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute('''CREATE TABLE games(id TEXT PRIMARY KEY, red_name TEXT, black_name TEXT,
            result INTEGER, played_at TEXT, event TEXT, red_team TEXT, black_team TEXT,
            record_kind TEXT DEFAULT 'played_game', statistical_eligible INTEGER DEFAULT 1)''')
        self.db.execute('PRAGMA foreign_keys=ON')
        players.initialize(self.db)

    def tearDown(self):
        self.db.close()

    def test_sources_merge_and_rerun_preserves_reviewed_bio_and_portrait(self):
        first = record()
        first['titles'] = [dict(issuer='WXF',code='IGM',label='IGM',status='recorded',source=first['source'])]
        second = record('xiangqiqipu','10',year=1975,biography={'en':'Original factual summary.'},
                        biographySources=['https://example.org/bio'],
                        photoCandidate={'url':'https://example.org/image','status':'permission-required'})
        directory_source = {**second['source'], 'url':'https://example.org/directory'}
        second['fieldSources'] = {'year':directory_source}
        pipeline.apply_records(self.db,[first,second])
        p = players.find(self.db,'wxf:IGM9000')
        self.assertEqual(p['year'],1975)
        self.assertEqual(p['fieldSources']['year'],directory_source)
        self.assertNotIn('photo',p)
        self.assertEqual(players.query(self.db,{})['total'],1)
        pipeline.apply_edits(self.db,{p['id']:{'changes':{'biography':{'en':'Reviewed summary.'},
                             'photo':{'id':'uploaded-portrait','credit':'Author'}}}},[])
        pipeline.apply_records(self.db,[first,second])
        self.assertEqual(self.db.execute('SELECT count(*) FROM players').fetchone()[0],1)
        self.assertEqual(players.find(self.db,p['id'])['biography']['en'],'Reviewed summary.')
        self.assertEqual(players.find(self.db,p['id'])['photo']['id'],'uploaded-portrait')
        players.refresh_stats(self.db)
        pipeline.apply_records(self.db,[first,second])
        self.assertEqual(players.refresh_stats(self.db),0)

    def test_homonyms_require_review_then_game_side_override_is_canonical(self):
        pipeline.apply_records(self.db,[record()])
        other = record('wxf','IM9001')
        report = pipeline.apply_records(self.db,[other])
        self.assertEqual(report['counts']['review'],1)
        self.assertIsNone(players.find(self.db,other['nativeName']))
        self.db.execute("INSERT INTO games VALUES('unresolved','测试甲','对手',1,'2020-01-01','','','','played_game',1)")
        players.refresh_stats(self.db)
        self.assertEqual(players.find(self.db,'wxf:IGM9000')['stats']['games'],0)
        pipeline.apply_records(self.db,[other],{'wxf:IM9001':'new'})
        self.db.execute("INSERT INTO games VALUES('game','测试甲','对手',1,'2020-01-01','','','','played_game',1)")
        players.refresh_stats(self.db)
        self.assertEqual(players.find(self.db,'wxf:IGM9000')['stats']['games'],0)
        pipeline.apply_edits(self.db,{},[dict(gameId='game',color='red',playerId='wxf:IM9001',sourceUrl='https://example.org/game')])
        players.refresh_stats(self.db)
        self.assertEqual(players.find(self.db,'wxf:IM9001')['stats']['wins'],1)
        self.db.execute("UPDATE games SET result=-1 WHERE id='game'")
        players.refresh_stats(self.db)
        self.assertEqual(players.find(self.db,'wxf:IM9001')['stats']['losses'],1)

    def test_untitled_profile_and_secondary_title_filter(self):
        r=record('cxa','2022:1')
        pipeline.apply_records(self.db,[r])
        self.assertEqual(players.query(self.db,{})['total'],0)
        self.assertEqual(players.query(self.db,{'titledOnly':False})['total'],1)
        r['titles']=[dict(issuer='CXA',code='NM',label='国家大师',status='recorded',source=r['source'])]
        pipeline.apply_records(self.db,[r])
        w=record()
        w['titles']=[dict(issuer='WXF',code='IM',label='IM',status='recorded',source=w['source'])]
        pipeline.apply_records(self.db,[w])
        self.assertEqual(players.query(self.db,{'title':'NM'})['total'],1)
        p=players.query(self.db,{})['players'][0]
        titles=p['titles']
        for title in titles:
            title.update(status='revoked',statusSource={**r['source'],'publishedAt':'2025-01-12'})
        pipeline.apply_edits(self.db,{p['id']:{'changes':{'titles':titles}}},[])
        pipeline.apply_records(self.db,[r,w])
        self.assertEqual(players.query(self.db,{})['total'],0)
        self.assertIsNotNone(players.find(self.db,p['id']))

    def test_birth_conflict_does_not_merge(self):
        pipeline.apply_records(self.db,[record(year=1970)])
        report=pipeline.apply_records(self.db,[record('xiangqiqipu','1',year=1985)])
        self.assertEqual(report['counts']['review'],1)
        self.assertEqual(players.find(self.db,'wxf:IGM9000')['year'],1970)

    def test_deployment_export_preserves_identity_review_and_existing_portrait(self):
        first, second = record(), record('xiangqiqipu','10')
        pipeline.apply_records(self.db,[first,second,record('wxf','IM9001')])
        pipeline.apply_edits(self.db,{'wxf:IGM9000':{'changes':{
            'photo':{'id':'approved-portrait','credit':'Source'}}}},[])
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)
            self.assertEqual(export(self.db,target),{'records':3,'portraits':1})
            batch=json.loads((target/'initial.json').read_text(encoding='utf-8'))
            decisions=json.loads((target/'decisions.json').read_text(encoding='utf-8'))
            edits=json.loads((target/'portraits.json').read_text(encoding='utf-8'))['players']
            self.db.execute('DELETE FROM player_sources')
            self.db.execute('DELETE FROM player_aliases')
            self.db.execute('DELETE FROM players')
            result=pipeline.apply_records(self.db,batch,decisions)
            self.assertEqual(result['counts']['review'],1)
            self.assertEqual(self.db.execute('SELECT count(*) FROM players').fetchone()[0],1)
            pipeline.apply_edits(self.db,edits,[])
            self.assertEqual(players.find(self.db,'wxf:IGM9000')['photo']['id'],'approved-portrait')
            pipeline.apply_edits(self.db,{'wxf:IGM9000':{'changes':{'photo':{'id':'new-edit'}}}},[])
            pipeline.apply_edits(self.db,edits,[])
            self.assertEqual(players.find(self.db,'wxf:IGM9000')['photo']['id'],'new-edit')

    def test_domestic_revocation_does_not_revoke_wxf_title(self):
        r=record()
        r['titles']=[dict(issuer='WXF',code='IGM',label='IGM',status='recorded',source=r['source'])]
        c=record('cxa','2022:1')
        c['titles']=[dict(issuer='CXA',code='GM',label='特级大师',status='recorded',source=c['source'])]
        n=dict(provider='cxa-notice',externalId='notice:1',nativeName=r['nativeName'],name=r['name'],
               source={**c['source'],'publishedAt':'2025-01-12'},titleStatus={'issuer':'CXA','status':'revoked'})
        pipeline.apply_records(self.db,[r,c,n])
        p=players.find(self.db,'wxf:IGM9000')
        self.assertEqual(p['title'],'IGM')
        self.assertEqual({t['issuer']:t['status'] for t in p['titles']},{'WXF':'recorded','CXA':'revoked'})
        pipeline.apply_records(self.db,[c])
        self.assertEqual(players.find(self.db,p['id'])['titles'],p['titles'])

    def test_unlock_releases_editorial_field_and_old_snapshot_cannot_roll_back(self):
        r=record(year=1975)
        r['source']['observedAt']='2026-10-26'
        pipeline.apply_records(self.db,[r])
        pipeline.apply_edits(self.db,{'wxf:IGM9000':{'changes':{'year':1976}}},[])
        pipeline.apply_records(self.db,[r])
        self.assertEqual(players.find(self.db,'wxf:IGM9000')['year'],1976)
        pipeline.apply_edits(self.db,{'wxf:IGM9000':{'unlock':['year']}},[])
        pipeline.apply_records(self.db,[r])
        self.assertEqual(players.find(self.db,'wxf:IGM9000')['year'],1975)
        old={**r,'year':1900,'source':{**r['source'],'observedAt':'2026-09-01'}}
        result=pipeline.apply_records(self.db,[old])
        self.assertEqual(result['counts']['olderSnapshotSkipped'],1)
        self.assertEqual(players.find(self.db,'wxf:IGM9000')['year'],1975)

    def test_migration_backs_up_old_rows_and_preserves_games(self):
        self.db.execute('ALTER TABLE players ADD COLUMN professional INTEGER DEFAULT 1')
        self.db.execute("INSERT INTO players(id,name,profile_json,updated_at) VALUES('wxf:IGM9000','Test',?,'now')",
                        (json.dumps({'id':'wxf:IGM9000','name':'Test','title':'IGM',
                         'provenance':record()['source'],'professional':True}),))
        self.db.commit()
        migration=importlib.import_module('tools.data_migration.20261026_player_registry')
        with tempfile.TemporaryDirectory() as directory:
            result=migration.migrate(self.db,Path(directory),writers_stopped=True)
            backup=json.loads(Path(result['backup']).read_text(encoding='utf-8'))
            self.assertEqual(len(backup['tables']['players']['rows']),1)
            self.assertEqual(players.find(self.db,'wxf:IGM9000')['title'],'IGM')
            self.assertNotIn('professional',[r[1] for r in self.db.execute('PRAGMA table_info(players)')])

    def test_parsers_fail_closed_and_keep_original_titles(self):
        with self.assertRaises(ValueError): sources.qipu_directory(b'<html>Login required</html>')
        with self.assertRaises(ValueError): sources.cxa('Proposed title list',record()['source'])
        text='IGM0001 中国 China 测试甲 Test Player 男 Male 国际特级大师 International Grandmaster'
        rows=sources.wxf(text,record()['source'])
        self.assertEqual(rows[0]['titles'][0]['code'],'IGM')
        with self.assertRaises(ValueError): sources.wxf(text.replace('Grandmaster','Master'),record()['source'])
        with self.assertRaises(ValueError): sources.wxf(text+'\n'+text,record()['source'])
        with self.assertRaises(ValueError):
            sources.title_notice('对测试甲处以禁赛的处罚。'.encode(),record()['source'],['测试甲'])
        notice='<h1>通知公告</h1><a href="../n5384/c1/content.html" title="公示象棋拟授予运动员技术等级称号">公示象棋拟授予...</a>'
        found=sources.discover_publications(notice.encode())
        self.assertEqual(found[0]['status'],'publication-review-required')
        with self.assertRaises(ValueError): sources.discover_publications(b'Login required')

    def test_profile_without_portrait_does_not_import_the_image_host_root(self):
        row=record('xiangqiqipu','10')
        row['directorySource']=row['source']
        for src in ('https://static.example.org', '//static.example.org/', ''):
            html=f'<h1>{row["name"]}</h1><div class="view-desc"><img src="{src}"></div>'
            self.assertNotIn('photoCandidate',sources.qipu_profile(html.encode(),row,row['source']))


if __name__ == '__main__': unittest.main()
