import json
import sqlite3
import unittest

from tools.games_database import players


def profile(identifier='wxf:IGM0002', name='Hu, Ronghua', aliases=None):
    p = {'id': identifier, 'name': name, 'aliases': aliases or ['胡荣华'],
            'title': 'IGM', 'provenance': {'provider': 'wxf', 'url': 'https://www.wxf-xiangqi.org/roster.pdf',
                                         'publishedAt': '2022-12-09'}}
    p['titles'] = [dict(issuer='WXF',code='IGM',label='IGM',status='recorded',source=p['provenance'])]
    return p


class PlayerCatalogTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute('''CREATE TABLE games(id TEXT PRIMARY KEY, red_name TEXT, black_name TEXT,
            result INTEGER, played_at TEXT, event TEXT, red_team TEXT, black_team TEXT,
            record_kind TEXT DEFAULT 'played_game', statistical_eligible INTEGER DEFAULT 1)''')
        players.initialize(self.db)
        players.upsert(self.db, profile())
        self.db.executemany('INSERT INTO games(id,red_name,black_name,result,played_at,red_team,black_team) VALUES(?,?,?,?,?,?,?)',
                            [('a','胡荣华','吕钦',1,'2000-01-01','Shanghai','Guangdong'),
                             ('b','吕钦','胡荣华',0,'2001-01-01','Guangdong','Shanghai'),
                             ('c','胡荣华','吕钦',-1,'2002-01-01','Shanghai','Guangdong')])

    def tearDown(self):
        self.db.close()

    def test_shared_stats_update_and_deletion(self):
        players.refresh_stats(self.db)
        p = players.find(self.db, '胡荣华')
        self.assertEqual(p['stats'], dict(games=3,wins=1,draws=1,losses=1,lastPlayedAt='2002-01-01',
                                          team='Shanghai',teamAsOf='2002-01-01'))
        self.db.execute("UPDATE games SET statistical_eligible=0 WHERE id='b'")
        self.db.execute("DELETE FROM games WHERE id='c'")
        players.refresh_stats(self.db)
        self.assertEqual(players.find(self.db, p['id'])['stats']['games'], 1)

    def test_ambiguity_never_attaches_another_persons_games(self):
        players.upsert(self.db,profile('wxf:IM0001','Hu, Ronghua',['胡荣华']))
        players.refresh_stats(self.db)
        self.assertIsNone(players.find(self.db,'胡荣华'))
        self.assertEqual(players.find(self.db,'wxf:IGM0002')['stats']['games'],0)
        players.upsert(self.db,profile('wxf:IM0001','Another player',['其他']))
        players.refresh_stats(self.db)
        self.assertEqual(players.find(self.db,'wxf:IGM0002')['stats']['games'],3)

    def test_same_romanization_does_not_merge_native_identities(self):
        players.upsert(self.db,profile('wxf:IM0001','Hu, Ronghua',['胡容华']))
        players.refresh_stats(self.db)
        self.assertIsNone(players.find(self.db,'Hu, Ronghua'))
        self.assertEqual(players.find(self.db,'wxf:IM0001')['stats']['games'],0)

    def test_search_and_sourced_fields(self):
        players.refresh_stats(self.db)
        self.assertEqual(players.query(self.db,{'search':'胡荣','title':'IGM'})['total'],1)
        self.assertEqual(players.query(self.db,{'ids':[]})['total'],0)
        for changes in ({'biography':{'en':'Unsourced'}}, {'standard':2600},
                        {'photo':{'url':'https://example.org/photo.jpg'}}, {'title':'WGM'},
                        {'standard':2600,'ratingSources':None},
                        {'standard':2600,'ratingSources':{'standard':{'url':'https://example.org/ratings'}}},
                        {'biographySources':None}):
            with self.assertRaises(ValueError):
                players.validate_profile({**profile(),**changes})

    def test_displayed_names_are_searchable_without_becoming_identity_aliases(self):
        for identifier, native in [('player:xu', '许文章'), ('player:meng', '孟辰'), ('player:meng2', '孟晨')]:
            players.upsert(self.db, profile(identifier, native, [native]))
        for query in ['Xu Wenzhang', 'xu', 'XU WENZHANG', 'Xu Wenzhang (许文章)', '许文章']:
            with self.subTest(query=query):
                result = players.query(self.db, {'search': query})
                self.assertEqual([p['id'] for p in result['players']], ['player:xu'])
        result = players.query(self.db, {'search': 'Meng Chen'})
        self.assertEqual({p['id'] for p in result['players']}, {'player:meng', 'player:meng2'})
        self.assertIsNone(players.find(self.db, 'Meng Chen'))
        self.assertEqual(players.query(self.db, {'search': 'zzzzzz'})['total'], 0)
        self.assertEqual(players.query(self.db, {'search': '!!!'})['total'], 0)
        self.assertEqual(players.query(self.db, {'search': 'Meng Chen', 'pageSize': 1, 'page': 2})['total'], 2)
        self.assertEqual(self.db.execute("SELECT count(*) FROM player_aliases WHERE name='Meng Chen'").fetchone()[0], 0)

    def test_score_order_uses_draws_and_pages_without_games_last(self):
        players.refresh_stats(self.db)
        for identifier, name, games, wins, draws in [
            ('player:winner', 'Winner', 4, 3, 0),
            ('player:draws', 'Draws', 3, 1, 2),
            ('player:loser', 'Loser', 4, 1, 0),
            ('player:empty', 'Empty', 0, 0, 0),
        ]:
            players.upsert(self.db, profile(identifier, name, [name]))
            self.db.execute('UPDATE players SET stats_json=? WHERE id=?',
                            (json.dumps(dict(games=games, wins=wins, draws=draws)), identifier))
        first = players.query(self.db, {'order': 'score', 'pageSize': 2})
        second = players.query(self.db, {'order': 'score', 'pageSize': 2, 'page': 2})
        last = players.query(self.db, {'order': 'score', 'pageSize': 2, 'page': 3})
        self.assertEqual([p['id'] for p in first['players']], ['player:winner', 'player:draws'])
        self.assertEqual([p['id'] for p in second['players']], ['wxf:IGM0002', 'player:loser'])
        self.assertEqual([p['id'] for p in last['players']], ['player:empty'])
        self.assertEqual(players.query(self.db, {'order': 'score', 'search': 'Draws'})['total'], 1)


if __name__ == '__main__':
    unittest.main()
