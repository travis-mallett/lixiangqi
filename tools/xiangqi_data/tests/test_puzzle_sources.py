"""Retained puzzle provenance resolves through the unified source catalog."""

import json
from contextlib import closing
import sqlite3
import tempfile
import unittest
from pathlib import Path

from tools.xiangqi_data.puzzle_mining.sources import catalog_source_paths, load_game


class PuzzleSourcesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "custom-games.sqlite3"
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TABLE games(id TEXT PRIMARY KEY,moves TEXT,initial_fen TEXT)")
            db.execute("CREATE TABLE game_sources(game_id TEXT,source TEXT,collection TEXT,external_id TEXT)")
            db.execute("INSERT INTO games VALUES('g:canonical',?,'')", (json.dumps(['a4a5']),))
            db.executemany("INSERT INTO game_sources VALUES('g:canonical',?,?,?)", [
                ('dpxq', '', '123'), ('gdchess_01xq', '', '456'), ('xqdao', '', '789'),
            ])

    def test_retained_source_ids_and_canonical_ids_load_same_moves(self):
        paths = catalog_source_paths([self.path])
        for database, game_id in [
            ('catalog', 'g:canonical'), ('dpxq', 'dpxq:123'),
            ('gdchess', 'gdchess_01xq:456'), ('xqdao', 'xqdao:789'),
        ]:
            with self.subTest(database=database):
                game = load_game(None, paths, database, game_id)
                self.assertEqual(game.moves, ('a4a5',))
                self.assertEqual(game.game_id, 'g:canonical')

    def test_wrong_source_is_rejected_and_missing_game_is_not_substituted(self):
        paths = catalog_source_paths([self.path])
        with self.assertRaisesRegex(ValueError, 'conflicts'):
            load_game(None, paths, 'xqdao', 'dpxq:123')
        with self.assertRaisesRegex(LookupError, 'not found'):
            load_game(None, paths, 'dpxq', 'dpxq:absent')

    def test_missing_catalog_fails_before_work_is_claimed(self):
        with self.assertRaises(sqlite3.OperationalError):
            catalog_source_paths([self.path.with_name('missing.sqlite3')])
