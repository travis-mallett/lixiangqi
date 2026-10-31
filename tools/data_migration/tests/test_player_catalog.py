"""Migration recovery tests on a disposable MongoDB, never a user database."""
import importlib
import os
from pathlib import Path
import tempfile
import unittest
import uuid

from bson import decode_all
from pymongo import MongoClient

from tools.games_database import players
from tools.games_database.storage import initialize
from tools.games_database.test_players import profile

migration = importlib.import_module('tools.data_migration.20261026_player_catalog')


@unittest.skipUnless(os.environ.get('LIXIANGQI_MIGRATION_TEST_URI'), 'disposable MongoDB required')
class PlayerMigrationTest(unittest.TestCase):
    def setUp(self):
        self.client = MongoClient(os.environ['LIXIANGQI_MIGRATION_TEST_URI'])
        self.mongo = self.client['pro_players_test_' + uuid.uuid4().hex]
        self.temp = tempfile.TemporaryDirectory()
        self.backup = Path(self.temp.name) / 'backup'
        self.catalog = players.connect(Path(self.temp.name) / 'catalog.sqlite3')
        initialize(self.catalog)
        self.original = profile()
        self.original['_id'] = self.original.pop('id')
        self.original['photo'] = {'id': 'original-portrait', 'credit': 'Original credit'}
        self.mongo.directory_player.insert_one(self.original)
        self.mongo.directory_player_rating.insert_one({'_id': self.original['_id'], 'standard': [2022012600]})
        self.mongo.directory_player_follower.insert_one({'_id': 'follow', 'p': self.original['_id'], 'u': 'alice'})

    def tearDown(self):
        self.catalog.close()
        assert self.mongo.name.startswith('pro_players_test_')
        self.client.drop_database(self.mongo.name)
        self.client.close()
        self.temp.cleanup()

    def migrate(self):
        return migration.migrate(self.mongo, self.catalog, self.backup, writers_stopped=True)

    def test_backup_import_and_retry_preserve_identity_photos_history_and_follows(self):
        self.assertEqual(self.migrate()['players'], 1)
        self.assertEqual(decode_all((self.backup / 'directory_player.bson').read_bytes()), [self.original])
        imported = players.find(self.catalog, self.original['_id'])
        self.assertEqual(imported['photo'], self.original['photo'])
        self.assertEqual(imported['ratingsHistory']['standard'], [2022012600])
        self.assertEqual(self.mongo.directory_player_follower.count_documents({}), 1)
        self.assertNotIn('directory_player_rating', self.mongo.list_collection_names())
        imported['photo']['credit'] = 'Edited later'
        imported.pop('stats')
        with self.catalog:
            players.upsert(self.catalog, imported)
        self.assertTrue(self.migrate()['alreadyComplete'])
        self.assertEqual(players.find(self.catalog, imported['id'])['photo']['credit'], 'Edited later')

    def test_bad_source_is_backed_up_and_never_removed(self):
        self.mongo.directory_player.update_one({}, {'$set': {'title': 'WGM'}})
        with self.assertRaises(ValueError):
            self.migrate()
        self.assertTrue((self.backup / 'manifest.json').is_file())
        self.assertEqual(self.mongo.directory_player.count_documents({}), 1)
        self.assertIsNone(players.find(self.catalog, self.original['_id']))

    def test_interrupted_cleanup_resumes_and_corrupt_backup_blocks_it(self):
        from unittest.mock import patch
        with patch.object(self.mongo, 'drop_collection', side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError):
                self.migrate()
        self.assertIsNotNone(players.find(self.catalog, self.original['_id']))
        archive = self.backup / 'directory_player.bson'
        intact = archive.read_bytes()
        archive.write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.migrate()
        self.assertEqual(self.mongo.directory_player.count_documents({}), 1)
        archive.write_bytes(intact)
        self.assertTrue(self.migrate()['alreadyComplete'])

    def test_requires_explicit_stopped_writer_gate(self):
        with self.assertRaises(ValueError):
            migration.migrate(self.mongo, self.catalog, self.backup, writers_stopped=False)
        self.assertFalse(self.backup.exists())


if __name__ == '__main__':
    unittest.main()
