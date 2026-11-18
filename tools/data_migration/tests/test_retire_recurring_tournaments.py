"""Run the retirement against isolated MongoDB fixtures, including safe retries."""
import os
from pathlib import Path
import subprocess
import unittest
from uuid import uuid4

from pymongo import MongoClient


@unittest.skipUnless(os.environ.get('REHEARSAL_TEST_MONGO_URI') and os.environ.get('MONGOSH_PATH'), 'MongoDB and mongosh required')
class RetireRecurringTest(unittest.TestCase):
    def setUp(self):
        self.uri = os.environ['REHEARSAL_TEST_MONGO_URI']
        if not self.uri.startswith('mongodb://127.0.0.1:'):
            raise ValueError('Loopback MongoDB required')
        self.client = MongoClient(self.uri, serverSelectionTimeoutMS=10000)
        self.db = self.client['retire_recurring_test_' + uuid4().hex[:16]]

    def tearDown(self):
        self.client.drop_database(self.db.name)
        self.client.close()

    def run_migration(self):
        return subprocess.run([
            os.environ['MONGOSH_PATH'], '--quiet', f'{self.uri}/{self.db.name}',
            '--file', str(Path(__file__).resolve().parents[1] / '20261114_retire_recurring_tournaments.js'),
        ], capture_output=True, text=True, timeout=45)

    def test_cleanup_cutoff_backups_and_retry(self):
        upcoming = {'_id': 'upcoming', 'status': 10, 'schedule': {'freq': 'hourly'}}
        started = {'_id': 'started', 'status': 20, 'schedule': {'freq': 'daily'}}
        preserved = [
            {'_id': 'finished', 'status': 30, 'schedule': {'freq': 'monthly'}},
            {'_id': 'manual', 'status': 10},
            {'_id': 'unique', 'status': 10, 'schedule': {'freq': 'unique'}, 'name': 'Community event'},
        ]
        anniversary = {'_id': 'anniversary', 'status': 10, 'schedule': {'freq': 'unique'}, 'name': '2027 Lixiangqi Anniversary'}
        self.db.tournament2.insert_many([upcoming, started, anniversary, *preserved])
        player = {'_id': 'participant', 'tid': 'upcoming'}
        game = {'_id': 'game', 'tid': 'started', 'status': 20}
        self.db.tournament_player.insert_one(player)
        self.db.game5.insert_one(game)
        for _ in range(2):
            result = self.run_migration()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIsNone(self.db.tournament2.find_one({'_id': 'upcoming'}))
        self.assertIsNone(self.db.tournament2.find_one({'_id': 'anniversary'}))
        self.assertIsNone(self.db.tournament_player.find_one({'_id': 'participant'}))
        self.assertIsNotNone(self.db.tournament2.find_one({'_id': 'started'})['scoreCutoff'])
        self.assertEqual(self.db.tournament2.find_one({'_id': 'started'})['status'], 20)
        for doc in preserved:
            self.assertEqual(self.db.tournament2.find_one({'_id': doc['_id']}), doc)
        for collection, doc in [('tournament2', upcoming), ('tournament2', started), ('tournament_player', player), ('game5', game)]:
            self.assertEqual(self.db['__retired_recurring_v1_' + collection].find_one({'_id': doc['_id']})['original'], doc)
        self.assertEqual(self.db.game5.find_one({'_id': 'game'}), game)

    def test_unexpected_history_blocks_removal(self):
        for collection, field in [('tournament_pairing', 'tid'), ('game5', 'tid'), ('three_kingdoms_game', 'tournamentId')]:
            with self.subTest(collection=collection):
                self.db.tournament2.replace_one({'_id': 'bad'}, {'_id': 'bad', 'status': 10, 'schedule': {'freq': 'weekly'}}, upsert=True)
                self.db[collection].insert_one({'_id': 'history', field: 'bad'})
                result = self.run_migration()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('has game history', result.stdout + result.stderr)
                self.assertIsNotNone(self.db.tournament2.find_one({'_id': 'bad'}))
                self.db[collection].delete_many({})


if __name__ == '__main__':
    unittest.main()
